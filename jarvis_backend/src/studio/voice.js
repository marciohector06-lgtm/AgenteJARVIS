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

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: narration,
          model_id: ELEVENLABS_MODEL,
          voice_settings: VOICE_SETTINGS,
        }),
      });

      if (response.ok) return Buffer.from(await response.arrayBuffer());

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

export async function generateVoice(script, videoId) {
  ensureStudioDirs();

  const narration = buildNarration(script);
  logger.info(`studio voice: sintetizando ${narration.length} chars para o vídeo ${videoId}`);

  const audio = await requestSpeech(narration);

  if (!audio || audio.length === 0) {
    throw new Error("ElevenLabs devolveu áudio vazio.");
  }

  const audioPath = join(AUDIO_DIR, `audio_${videoId}.mp3`);
  writeFileSync(audioPath, audio);

  return { audioPath, narration };
}
