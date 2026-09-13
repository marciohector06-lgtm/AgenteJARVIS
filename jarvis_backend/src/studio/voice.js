import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { AUDIO_DIR, ensureStudioDirs } from "./paths.js";

const ELEVENLABS_MODEL = "eleven_multilingual_v2";
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1500;

const VOICE_SETTINGS = {
  stability: 0.4,
  similarity_boost: 0.82,
  style: 0.6,
  use_speaker_boost: true,
};

export function buildNarration(script) {
  return [`${script.hook}.`, ...script.scenes.map((scene) => scene.narration), `${script.cta}.`]
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(" ");
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestSpeech(narration) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) throw new Error("ELEVENLABS_API_KEY não configurada no .env.");
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID não configurada no .env.");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          text: narration,
          model_id: ELEVENLABS_MODEL,
          voice_settings: VOICE_SETTINGS,
        }),
      });

      if (response.ok) return response.json();

      const detail = await response.text().catch(() => "");
      const error = new Error(`ElevenLabs respondeu ${response.status}: ${detail.slice(0, 200)}`);

      if (!isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
    }

    const waitMs = BASE_BACKOFF_MS * 2 ** (attempt - 1);
    logger.warn(`studio voice: tentativa ${attempt}/${MAX_ATTEMPTS} falhou (${lastError.message}) — nova tentativa em ${waitMs}ms`);
    await sleep(waitMs);
  }

  throw lastError;
}

export function alignmentToWords(alignment) {
  const characters = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];

  const words = [];
  let current = null;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const isSpace = /\s/.test(char);

    if (isSpace) {
      if (current) {
        words.push(current);
        current = null;
      }
      continue;
    }

    if (!current) {
      current = { text: char, start: starts[i] ?? 0, end: ends[i] ?? starts[i] ?? 0 };
    } else {
      current.text += char;
      current.end = ends[i] ?? current.end;
    }
  }

  if (current) words.push(current);

  return words;
}

export async function generateVoice(script, videoId) {
  ensureStudioDirs();

  const narration = buildNarration(script);
  logger.info(`studio voice: sintetizando ${narration.length} chars para o vídeo ${videoId}`);

  const payload = await requestSpeech(narration);

  if (!payload?.audio_base64) {
    throw new Error("ElevenLabs não devolveu áudio (campo audio_base64 ausente).");
  }

  const audioPath = join(AUDIO_DIR, `audio_${videoId}.mp3`);
  writeFileSync(audioPath, Buffer.from(payload.audio_base64, "base64"));

  const alignment = payload.normalized_alignment || payload.alignment || null;
  const words = alignment ? alignmentToWords(alignment) : [];

  if (words.length === 0) {
    logger.warn("studio voice: ElevenLabs não devolveu alinhamento — o vídeo sai sem legenda queimada");
  }

  return { audioPath, narration, words };
}
