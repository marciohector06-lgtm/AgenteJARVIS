import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";
import { CLIP_DIR, ensureStudioDirs } from "./paths.js";
import { sleep, gaussianDelay } from "./browser.js";
import { parseVideoUrl } from "./hookMiner.js";
import { saveMinedHook } from "./hookStore.js";

const OPENING_SECONDS = 4;
const CAPTURE_WAIT_MS = 14_000;
const MIN_CLIP_BYTES = 20_000;
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

const ANALYSIS_PROMPT = `
Você analisa a ABERTURA de vídeos de UGC do TikTok Shop Brasil para entender o que
segura o espectador nos primeiros segundos.

Este clipe tem apenas os primeiros segundos de um vídeo que está performando bem.

Faça três coisas:
1. Transcreva exatamente o que é FALADO (se não houver fala, descreva o texto na tela).
2. Classifique em qual destas fórmulas de gancho a abertura se encaixa melhor:
   1 = confissão pessoal sem nomear o item
   2 = resultado/consequência mostrado antes da causa
   3 = chamado direto a um público específico numa situação real
   4 = afirmação contra-intuitiva ou polêmica
   5 = alerta de erro comum antes de comprar
   6 = corte no meio da ação, cena ou sensação física
   0 = não se encaixa em nenhuma
3. Descreva o MECANISMO em uma frase: que tensão, curiosidade ou identificação essa
   abertura cria para impedir a pessoa de rolar o feed. Descreva o mecanismo em termos
   gerais, NUNCA copie a frase do vídeo como se fosse um modelo a repetir.

Dê também uma nota de 0 a 10 de quanto essa abertura prende nos 3 primeiros segundos,
e justifique em uma frase.

Responda APENAS com JSON válido, sem markdown:
{
  "transcript": "o que é falado",
  "formula": "1",
  "mechanism": "descrição do mecanismo em uma frase",
  "gripScore": 8,
  "rationale": "por que prende ou não"
}
`.trim();

export async function captureOpeningClip(page, videoUrl, { seconds = OPENING_SECONDS } = {}) {
  ensureStudioDirs();

  const parsed = parseVideoUrl(videoUrl);
  if (!parsed) throw new Error(`URL de vídeo inválida: ${videoUrl}`);

  const chunks = [];

  const onResponse = async (response) => {
    const contentType = response.headers()["content-type"] || "";
    if (!contentType.includes("video/")) return;

    try {
      const buffer = await response.buffer();
      if (buffer.length >= MIN_CLIP_BYTES) chunks.push(buffer);
    } catch {
      /* resposta já descartada pelo browser */
    }
  };

  page.on("response", onResponse);

  try {
    await page.goto(videoUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(gaussianDelay(CAPTURE_WAIT_MS, 2500, 8000, 22_000));
  } finally {
    page.off("response", onResponse);
  }

  if (chunks.length === 0) return null;

  const maior = chunks.sort((a, b) => b.length - a.length)[0];

  const brutoPath = join(CLIP_DIR, `bruto_${parsed.videoId}.mp4`);
  const clipePath = join(CLIP_DIR, `abertura_${parsed.videoId}.mp4`);

  writeFileSync(brutoPath, maior);

  try {
    execFileSync(ffmpegPath, ["-y", "-i", brutoPath, "-t", String(seconds), "-c", "copy", clipePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    try {
      execFileSync(ffmpegPath, ["-y", "-i", brutoPath, "-t", String(seconds), clipePath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      rmSync(brutoPath, { force: true });
      throw new Error(`Não deu para recortar a abertura: ${error.message.split("\n")[0]}`);
    }
  } finally {
    rmSync(brutoPath, { force: true });
  }

  return existsSync(clipePath) ? clipePath : null;
}

export async function analyzeClip(clipPath, { caption = "" } = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY ausente — sem ela não dá para analisar o gancho.");

  const bytes = readFileSync(clipPath);
  if (bytes.length > MAX_INLINE_BYTES) throw new Error("Clipe grande demais para análise inline.");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: caption ? `${ANALYSIS_PROMPT}\n\nLegenda do post: "${caption}"` : ANALYSIS_PROMPT },
          { inline_data: { mime_type: "video/mp4", data: bytes.toString("base64") } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 900 },
  };

  let lastError;

  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const model = MODEL_FALLBACK_CHAIN[i];

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        const error = new Error(`Gemini respondeu ${res.status}: ${detail.slice(0, 160)}`);
        error.status = res.status;
        throw error;
      }

      const payload = await res.json();
      const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text || "";

      return JSON.parse(raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    } catch (error) {
      lastError = error;
      const isLast = i === MODEL_FALLBACK_CHAIN.length - 1;

      if (!isLast && (isQuotaError(error) || error.status >= 500 || error instanceof SyntaxError)) {
        logger.warn(`studio hookAnalyzer: "${model}" falhou (${error.message.slice(0, 60)}) — tentando o próximo`);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

export async function analyzeCandidate(page, candidate) {
  const clipePath = await captureOpeningClip(page, candidate.videoUrl);

  if (!clipePath) {
    logger.warn(`studio hookAnalyzer: não capturei o vídeo de ${candidate.videoUrl}`);
    return null;
  }

  try {
    const analise = await analyzeClip(clipePath, { caption: candidate.caption });

    const gravado = saveMinedHook({
      niche: candidate.niche || "",
      sourceUrl: candidate.videoUrl,
      transcript: analise.transcript,
      formula: String(analise.formula ?? ""),
      mechanism: analise.mechanism,
      gripScore: Number(analise.gripScore),
      rationale: analise.rationale,
      views: candidate.likes || candidate.cardLikes || 0,
    });

    logger.info(
      `studio hookAnalyzer: ${candidate.videoUrl.slice(-19)} — fórmula ${analise.formula}, nota ${analise.gripScore}`,
    );

    return gravado || { ...analise, jaExistia: true };
  } finally {
    rmSync(clipePath, { force: true });
  }
}

export async function mineHooksForNiche(niche, { discoverLimit = 15, analyzeLimit = 5 } = {}) {
  const { withMinerBrowser, mineNiche } = await import("./hookMiner.js");

  return withMinerBrowser(async (page) => {
    const ranqueados = await mineNiche(page, niche, { discoverLimit, measureLimit: analyzeLimit * 2 });

    if (ranqueados.length === 0) {
      logger.warn(`studio hookAnalyzer: nenhum candidato para "${niche}"`);
      return [];
    }

    const analisados = [];

    for (const candidato of ranqueados.slice(0, analyzeLimit)) {
      try {
        const resultado = await analyzeCandidate(page, { ...candidato, niche });
        if (resultado) analisados.push(resultado);
      } catch (error) {
        logger.warn(`studio hookAnalyzer: falha analisando ${candidato.videoUrl}: ${error.message.slice(0, 90)}`);
      }

      await sleep(gaussianDelay(4000, 1500, 2000, 10_000));
    }

    logger.info(`studio hookAnalyzer: ${analisados.length} gancho(s) minerado(s) para "${niche}"`);

    return analisados;
  });
}
