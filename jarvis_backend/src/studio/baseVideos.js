import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { BASE_VIDEOS_DIR } from "./paths.js";

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];

const CHARS_PER_SECOND = 13;
const CHARS_PER_WORD = 5.8;
const HOOK_MAX_WORDS = 10;
const CTA_MAX_WORDS = 12;
const MIN_BUDGET_RATIO = 0.85;
const SHORT_HEADROOM_SECONDS = 2;
const LONG_HEADROOM_SECONDS = 3;
const LONG_VIDEO_SECONDS = 27;
const TWO_SCENE_SECONDS = 20;
const THREE_SCENE_SECONDS = 27;

export function measureDurationSeconds(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Vídeo base não encontrado: ${filePath}`);
  }

  let output = "";
  try {
    output = execFileSync(ffmpegPath, ["-i", filePath], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (error) {
    output = `${error.stdout?.toString() || ""}${error.stderr?.toString() || ""}`;
  }

  const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  if (!match) {
    throw new Error(`Não foi possível medir a duração de ${filePath} — o arquivo pode estar corrompido.`);
  }

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number.parseFloat(match[3]);
}

export function listBaseVideos(offerId) {
  const offerDir = join(BASE_VIDEOS_DIR, String(offerId));
  const dir = existsSync(offerDir) ? offerDir : BASE_VIDEOS_DIR;

  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((file) => VIDEO_EXTENSIONS.includes(extname(file).toLowerCase()))
    .sort()
    .map((file) => join(dir, file));
}

export function selectBaseVideo(offerId, rotationIndex = 0) {
  const videos = listBaseVideos(offerId);

  if (videos.length === 0) {
    throw new Error(
      `Nenhum vídeo base para a oferta "${offerId}". Coloque ao menos um arquivo em ${join(BASE_VIDEOS_DIR, String(offerId))}.`,
    );
  }

  const index = ((Number(rotationIndex) || 0) % videos.length + videos.length) % videos.length;
  return videos[index];
}

export function narrationBudget(durationSeconds) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Duração inválida para calcular o budget de narração: ${durationSeconds}`);
  }

  const headroom = duration >= LONG_VIDEO_SECONDS ? LONG_HEADROOM_SECONDS : SHORT_HEADROOM_SECONDS;
  const maxNarrationSeconds = Math.max(Math.floor(duration - headroom), 1);
  const charBudget = Math.floor(maxNarrationSeconds * CHARS_PER_SECOND);
  const minCharBudget = Math.floor(charBudget * MIN_BUDGET_RATIO);

  let sceneCount = 1;
  if (duration >= THREE_SCENE_SECONDS) sceneCount = 3;
  else if (duration >= TWO_SCENE_SECONDS) sceneCount = 2;

  const totalWords = Math.floor(charBudget / CHARS_PER_WORD);
  const hookWords = Math.min(HOOK_MAX_WORDS, Math.floor(totalWords * 0.25));
  const ctaWords = Math.min(CTA_MAX_WORDS, Math.floor(totalWords * 0.25));
  const wordsPerScene = Math.max(Math.floor((totalWords - hookWords - ctaWords) / sceneCount), 6);

  return {
    durationSeconds: duration,
    maxNarrationSeconds,
    charBudget,
    minCharBudget,
    sceneCount,
    totalWords,
    hookWords,
    ctaWords,
    wordsPerScene,
  };
}

export function budgetForBaseVideo(baseVideoPath) {
  return { baseVideoPath, ...narrationBudget(measureDurationSeconds(baseVideoPath)) };
}
