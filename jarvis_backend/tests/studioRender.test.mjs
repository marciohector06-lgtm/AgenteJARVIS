import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-render-"));

process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.STUDIO_ROOT = join(workDir, "studio-data");

const { ensureStudioDirs } = await import("../src/studio/paths.js");
const { renderVideo, buildVideoFilters, pickVariation } = await import("../src/studio/render.js");
const { measureDurationSeconds } = await import("../src/studio/baseVideos.js");
const { buildNarration } = await import("../src/studio/voice.js");

const RENDER_TIMEOUT_MS = 180_000;

function ffmpeg(args) {
  return execFileSync(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function probe(filePath) {
  try {
    return ffmpeg(["-i", filePath]).toString();
  } catch (error) {
    return `${error.stdout?.toString() || ""}${error.stderr?.toString() || ""}`;
  }
}

function resolutionOf(filePath) {
  const match = probe(filePath).match(/, (\d{2,5})x(\d{2,5})[ ,]/);
  return match ? `${match[1]}x${match[2]}` : null;
}

function makeBaseVideo(name, seconds) {
  const path = join(workDir, name);
  ffmpeg(["-y", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=720x1280:rate=30`, "-pix_fmt", "yuv420p", path]);
  return path;
}

function makeAudio(name, seconds) {
  const path = join(workDir, name);
  ffmpeg(["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-b:a", "192k", path]);
  return path;
}

before(() => {
  ensureStudioDirs();
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test("buildNarration junta hook, cenas e CTA na ordem falada", () => {
  const narration = buildNarration({
    hook: "Ninguém te avisa isso",
    scenes: [{ narration: "Primeira cena." }, { narration: "Segunda cena." }],
    cta: "Link aqui embaixo",
  });

  assert.equal(narration, "Ninguém te avisa isso. Primeira cena. Segunda cena. Link aqui embaixo.");
});

test("variação nunca espelha o vídeo — a orientação original é regra do projeto", () => {
  const filters = buildVideoFilters({ keepAsIs: false, variation: pickVariation(0), freezeSeconds: 0 });

  assert.ok(!filters.some((filter) => filter.includes("hflip")), "nenhuma variação pode espelhar");
  assert.ok(filters.some((filter) => filter.startsWith("crop=")));
});

test("nenhum filtro desenha texto sobre o vídeo — o corte final sai limpo", () => {
  const comVariacao = buildVideoFilters({ keepAsIs: false, variation: pickVariation(2), freezeSeconds: 1 });
  const keepAsIs = buildVideoFilters({ keepAsIs: true, variation: pickVariation(0), freezeSeconds: 0 });

  for (const filters of [comVariacao, keepAsIs]) {
    assert.ok(!filters.some((filter) => /subtitles=|drawtext=|ass=/.test(filter)), "nenhuma legenda pode ser queimada");
  }
});

test("keepAsIs não aplica crop, zoom nem brilho", () => {
  const filters = buildVideoFilters({ keepAsIs: true, variation: pickVariation(0), freezeSeconds: 0 });

  assert.equal(filters.length, 0);
});

test(
  "render com narração mais curta que o vídeo entrega 1080x1920 e termina no áudio",
  { timeout: RENDER_TIMEOUT_MS },
  async () => {
    const result = await renderVideo({
      videoId: "curto",
      baseVideoPath: makeBaseVideo("base_curto.mp4", 6),
      audioPath: makeAudio("audio_curto.mp3", 3),
    });

    assert.ok(existsSync(result.outputPath));
    assert.ok(statSync(result.outputPath).size > 0);
    assert.equal(resolutionOf(result.outputPath), "1080x1920");
    assert.equal(result.freezeSeconds, 0);

    const duration = measureDurationSeconds(result.outputPath);
    assert.ok(Math.abs(duration - 3) < 0.6, `esperava ~3s, veio ${duration}s`);
  },
);

test(
  "narração mais longa que o vídeo congela o último frame em vez de cortar a fala",
  { timeout: RENDER_TIMEOUT_MS },
  async () => {
    const result = await renderVideo({
      videoId: "longo",
      baseVideoPath: makeBaseVideo("base_longo.mp4", 3),
      audioPath: makeAudio("audio_longo.mp3", 6),
    });

    assert.ok(result.freezeSeconds > 0, "deveria congelar o último frame");

    const duration = measureDurationSeconds(result.outputPath);
    assert.ok(duration > 5.5, `a fala de 6s não pode ser cortada, veio ${duration}s`);
  },
);
