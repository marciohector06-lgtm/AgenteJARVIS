import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-producer-"));

process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.STUDIO_ROOT = join(workDir, "studio-data");

const { createOffer, setOfferActive } = await import("../src/studio/offers.js");
const { offerReadiness, offersReadyToProduce } = await import("../src/studio/producer.js");
const { saveMinedHook, searchMinedHooks, countMinedHooks } = await import("../src/studio/hookStore.js");
const { formulaPerformance } = await import("../src/studio/measurement.js");
const { BASE_VIDEOS_DIR, ensureStudioDirs } = await import("../src/studio/paths.js");
const pipeline = await import("../src/studio/pipeline.js");
const { db } = await import("../src/studio/db.js");

const chavesOriginais = {
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

function comChaves() {
  process.env.ELEVENLABS_API_KEY = "x";
  process.env.ELEVENLABS_VOICE_ID = "y";
  process.env.GEMINI_API_KEY = "z";
}

function comVideoBase(offerId) {
  const dir = join(BASE_VIDEOS_DIR, offerId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "base.mp4"), "");
}

before(() => {
  ensureStudioDirs();
  createOffer({ id: "pronta", productName: "magnésio em pó", category: "Suplementos" });
  createOffer({ id: "sem-video", productName: "perfume masculino", category: "Perfumes" });
  comVideoBase("pronta");
});

beforeEach(() => {
  comChaves();
});

after(() => {
  Object.entries(chavesOriginais).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("oferta sem vídeo base não é considerada pronta", () => {
  const r = offerReadiness("sem-video");
  assert.equal(r.ready, false);
  assert.match(r.reason, /Coloque ao menos um arquivo/);
});

test("oferta com vídeo base e chaves fica pronta", () => {
  assert.equal(offerReadiness("pronta").ready, true);
});

test("sem chave da ElevenLabs, nada é dado como pronto — falha antes de gastar Gemini", () => {
  delete process.env.ELEVENLABS_API_KEY;

  const r = offerReadiness("pronta");
  assert.equal(r.ready, false);
  assert.match(r.reason, /ELEVENLABS/);
});

test("sem chave do Gemini a oferta também não produz", () => {
  delete process.env.GEMINI_API_KEY;

  const r = offerReadiness("pronta");
  assert.equal(r.ready, false);
  assert.match(r.reason, /GEMINI/);
});

test("oferta pausada sai da lista de prontas", () => {
  setOfferActive("pronta", false);
  assert.equal(offersReadyToProduce().length, 0);

  setOfferActive("pronta", true);
  assert.equal(offersReadyToProduce().length, 1);
});

test("oferta inexistente não explode, só informa", () => {
  const r = offerReadiness("nao-existe");
  assert.equal(r.ready, false);
  assert.match(r.reason, /não existe/);
});

test("gancho minerado é guardado e não duplica pela mesma URL", () => {
  const url = "https://www.tiktok.com/@alguem/video/123";

  const primeiro = saveMinedHook({
    niche: "Suplementos",
    sourceUrl: url,
    transcript: "eu só descobri isso depois de anos",
    formula: "5",
    mechanism: "alerta de erro comum antes de comprar",
    gripScore: 9,
    views: 5000,
  });

  assert.ok(primeiro);
  assert.equal(saveMinedHook({ niche: "Suplementos", sourceUrl: url, transcript: "outro" }), null);
  assert.equal(countMinedHooks(), 1);
});

test("busca de ganchos casa pelo nicho e devolve o de maior nota primeiro", async () => {
  saveMinedHook({
    niche: "Suplementos",
    sourceUrl: "https://www.tiktok.com/@outro/video/456",
    transcript: "ninguém te avisa",
    formula: "1",
    mechanism: "confissão pessoal",
    gripScore: 10,
    views: 100,
  });

  const encontrados = await searchMinedHooks("Suplementos / Saúde", { limit: 5 });

  assert.ok(encontrados.length >= 2);
  assert.equal(encontrados[0].gripScore, 10, "o de maior nota tem que vir primeiro");
});

test("nicho sem gancho nenhum cai nos melhores gerais em vez de devolver vazio", async () => {
  const encontrados = await searchMinedHooks("Nicho Que Não Existe", { limit: 3 });
  assert.ok(encontrados.length > 0, "sem fallback o roteirista perde a referência de mecanismo");
});

test("desempenho por fórmula agrega as decisões registradas", () => {
  const video = pipeline.createVideo({ offerId: "pronta" });
  const arquivo = join(workDir, "v.mp4");
  writeFileSync(arquivo, "mp4");

  pipeline.transition(video.id, pipeline.STATES.RENDERED, {
    videoPath: arquivo,
    script: { hook: "gancho de teste", scenes: [], cta: "cta" },
    hookFormula: "5 (alerta de erro comum)",
  });
  pipeline.submitForApproval(video.id);
  pipeline.recordDecision(video.id, "approve");

  const linhas = formulaPerformance();
  const alvo = linhas.find((l) => l.hookFormula === "5 (alerta de erro comum)");

  assert.ok(alvo, "a fórmula usada deveria aparecer no relatório");
  assert.equal(alvo.total, 1);
  assert.equal(alvo.aprovados, 1);
  assert.equal(alvo.taxaAprovacao, 100);
});

test("cron não empilha: com a fila cheia, não produz nada", async () => {
  const { runStudioProduction } = await import("../src/proactive/studio.js");

  for (let i = 0; i < 5; i++) {
    const video = pipeline.createVideo({ offerId: "pronta" });
    const arquivo = join(workDir, `fila_${i}.mp4`);
    writeFileSync(arquivo, "mp4");
    pipeline.transition(video.id, pipeline.STATES.RENDERED, { videoPath: arquivo });
    pipeline.submitForApproval(video.id);
  }

  assert.ok(pipeline.pendingApprovals().length >= 5);

  const produzidos = await runStudioProduction();
  assert.equal(produzidos.length, 0, "com 5 esperando aprovação, produzir mais é queimar crédito à toa");
});

test("startStudio não agenda nada com STUDIO_ENABLED diferente de true", async () => {
  const { startStudio } = await import("../src/proactive/studio.js");
  const cron = (await import("node-cron")).default;

  const original = cron.schedule;
  let agendou = 0;
  cron.schedule = () => {
    agendou++;
    return { stop() {} };
  };

  try {
    delete process.env.STUDIO_ENABLED;
    startStudio();
    assert.equal(agendou, 0, "sem STUDIO_ENABLED=true o cron não pode subir sozinho");

    process.env.STUDIO_ENABLED = "false";
    startStudio();
    assert.equal(agendou, 0);

    process.env.STUDIO_ENABLED = "true";
    startStudio();
    assert.equal(agendou, 2, "com a flag ligada, produção e medição são agendadas");
  } finally {
    cron.schedule = original;
    delete process.env.STUDIO_ENABLED;
  }
});
