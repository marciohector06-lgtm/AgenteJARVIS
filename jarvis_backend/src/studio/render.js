import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import ffmpegLib from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { logger } from "../logger.js";
import { VIDEO_DIR, ensureStudioDirs } from "./paths.js";
import { measureDurationSeconds } from "./baseVideos.js";

ffmpegLib.setFfmpegPath(ffmpegPath);

const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;
const FREEZE_PADDING_SECONDS = 0.5;

const VARIATIONS = [
  { crop: 3, brightness: 0.03 },
  { crop: 4, brightness: -0.02 },
  { crop: 2, brightness: 0.05 },
  { crop: 3, brightness: 0 },
  { crop: 5, brightness: -0.03 },
];

export function pickVariation(rotationIndex = 0) {
  const index = ((Number(rotationIndex) || 0) % VARIATIONS.length + VARIATIONS.length) % VARIATIONS.length;
  return VARIATIONS[index];
}

export function escapeFilterPath(filePath) {
  return String(filePath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function buildVideoFilters({ keepAsIs, variation, captionPath, freezeSeconds }) {
  const filters = [];

  if (!keepAsIs) {
    filters.push(`scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`);
    filters.push(`pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`);

    const cropFactor = (1 - variation.crop / 100).toFixed(4);
    filters.push(`crop=iw*${cropFactor}:ih*${cropFactor}:iw*(1-${cropFactor})/2:ih*(1-${cropFactor})/2`);
    filters.push(`scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}`);

    if (variation.brightness !== 0) {
      filters.push(`eq=brightness=${variation.brightness}`);
    }
  }

  if (captionPath) {
    filters.push(`subtitles='${escapeFilterPath(captionPath)}'`);
  }

  if (freezeSeconds > 0) {
    filters.push(`tpad=stop_mode=clone:stop_duration=${freezeSeconds.toFixed(2)}`);
  }

  return filters;
}

export function renderVideo({ videoId, baseVideoPath, audioPath, captionPath = null, keepAsIs = false, rotationIndex = 0 }) {
  ensureStudioDirs();

  if (!existsSync(baseVideoPath)) throw new Error(`Vídeo base não encontrado: ${baseVideoPath}`);
  if (!existsSync(audioPath)) throw new Error(`Áudio não encontrado: ${audioPath}`);

  const videoDuration = measureDurationSeconds(baseVideoPath);
  const audioDuration = measureDurationSeconds(audioPath);
  const freezeSeconds = audioDuration > videoDuration ? audioDuration - videoDuration + FREEZE_PADDING_SECONDS : 0;

  const variation = pickVariation(rotationIndex);
  const videoFilters = buildVideoFilters({ keepAsIs, variation, captionPath, freezeSeconds });

  const audioFilters = ["loudnorm=I=-16:TP=-1.5:LRA=11"];
  if (keepAsIs) audioFilters.push("apad");

  const outputPath = join(VIDEO_DIR, `video_${videoId}.mp4`);

  const videoOptions = keepAsIs
    ? ["-c:v libx264", "-preset fast", "-crf 20", "-pix_fmt yuv420p"]
    : ["-c:v libx264", "-preset fast", "-crf 22", `-r ${OUTPUT_FPS}`, "-pix_fmt yuv420p"];

  const endOption = keepAsIs ? `-t ${Math.max(videoDuration, audioDuration).toFixed(2)}` : "-shortest";

  if (freezeSeconds > 0) {
    logger.info(
      `studio render: narração (${audioDuration.toFixed(1)}s) maior que o vídeo base (${videoDuration.toFixed(1)}s) — congelando último frame por +${freezeSeconds.toFixed(2)}s`,
    );
  }

  return new Promise((resolve, reject) => {
    const command = ffmpegLib()
      .input(baseVideoPath)
      .input(audioPath)
      .outputOptions([
        "-map 0:v:0",
        ...(videoFilters.length ? [`-vf ${videoFilters.join(",")}`] : []),
        ...videoOptions,
        "-map 1:a:0",
        `-af ${audioFilters.join(",")}`,
        "-c:a aac",
        "-b:a 192k",
        "-movflags +faststart",
        endOption,
      ])
      .output(outputPath);

    let lastStderr = "";

    command
      .on("stderr", (line) => {
        lastStderr = line;
      })
      .on("end", () => {
        const sizeMB = statSync(outputPath).size / 1024 / 1024;
        logger.info(`studio render: ${basename(outputPath)} pronto (${sizeMB.toFixed(1)}MB)`);
        resolve({ outputPath, sizeMB, videoDuration, audioDuration, freezeSeconds, variation });
      })
      .on("error", (error) => {
        reject(new Error(`FFmpeg falhou: ${error.message}${lastStderr ? ` | último stderr: ${lastStderr}` : ""}`));
      })
      .run();
  });
}
