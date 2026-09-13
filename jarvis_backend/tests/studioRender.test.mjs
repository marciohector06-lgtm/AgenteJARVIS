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
const { writeCaptionFile, groupWordsIntoCues, buildAss } = await import("../src/studio/captions.js");
const { renderVideo, escapeFilterPath, buildVideoFilters, pickVariation } = await import("../src/studio/render.js");
const { measureDurationSeconds } = await import("../src/studio/baseVideos.js");
const { alignmentToWords, buildNarration } = await import("../src/studio/voice.js");

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

const words = [
  { text: "dormir", start: 0.0, end: 0.5 },
  { text: "bem", start: 0.5, end: 0.9 },
  { text: "mudou", start: 0.9, end: 1.4 },
  { text: "tudo", start: 1.4, end: 1.9 },
  { text: "pra", start: 2.0, end: 2.2 },
  { text: "mim", start: 2.2, end: 2.7 },
];

before(() => {
  ensureStudioDirs();
});

after(() => {
  rmSync(workDir, { recursive: true, force: true });
});

test("alignmentToWords reconstrói palavras a partir do alinhamento por caractere", () => {
  const alignment = {
    characters: ["o", "i", " ", "t", "u", "d", "o"],
    character_start_times_seconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
  };

  const result = alignmentToWords(alignment);
  assert.deepEqual(result.map((w) => w.text), ["oi", "tudo"]);
  assert.equal(result[0].start, 0.0);
  assert.equal(result[1].end, 0.7);
});

test("buildNarration junta hook, cenas e CTA na ordem falada", () => {
  const narration = buildNarration({
    hook: "Ninguém te avisa isso",
    scenes: [{ narration: "Primeira cena." }, { narration: "Segunda cena." }],
    cta: "Link aqui embaixo",
  });

  assert.equal(narration, "Ninguém te avisa isso. Primeira cena. Segunda cena. Link aqui embaixo.");
});

test("cues respeitam o limite de palavras e não se sobrepõem no tempo", () => {
  const cues = groupWordsIntoCues(words);

  assert.ok(cues.length >= 2);
  for (const cue of cues) {
    assert.ok(cue.text.split(" ").length <= 3, `cue "${cue.text}" tem palavras demais`);
    assert.ok(cue.end > cue.start, `cue "${cue.text}" tem duração não positiva`);
  }

  for (let i = 0; i < cues.length - 1; i++) {
    assert.ok(cues[i].end <= cues[i + 1].start + 1e-9, "cues não podem se sobrepor");
  }
});

test("ASS gerado tem cabeçalho válido e um Dialogue por cue", () => {
  const ass = buildAss(words);
  const cues = groupWordsIntoCues(words);

  assert.match(ass, /\[Script Info\]/);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Style: Sodre/);
  assert.equal(ass.match(/^Dialogue: /gm).length, cues.length);
  assert.match(ass, /0:00:00\.00/);
});

test("chaves no texto são escapadas para não virar override tag do ASS", () => {
  const ass = buildAss([{ text: "{teste}", start: 0, end: 1 }]);
  assert.match(ass, /\\\{TESTE\\\}/);
});

test("escapeFilterPath neutraliza a letra de unidade do Windows", () => {
  assert.equal(escapeFilterPath("C:\\Users\\marci\\a.ass"), "C\\:/Users/marci/a.ass");
});

test("variação nunca espelha o vídeo — a orientação original é regra do projeto", () => {
  const filters = buildVideoFilters({
    keepAsIs: false,
    variation: pickVariation(0),
    captionPath: null,
    freezeSeconds: 0,
  });

  assert.ok(!filters.some((filter) => filter.includes("hflip")), "nenhuma variação pode espelhar");
  assert.ok(filters.some((filter) => filter.startsWith("crop=")));
});

test("keepAsIs não aplica crop, zoom nem brilho, mas ainda queima legenda", () => {
  const filters = buildVideoFilters({
    keepAsIs: true,
    variation: pickVariation(0),
    captionPath: "C:\\tmp\\x.ass",
    freezeSeconds: 0,
  });

  assert.ok(!filters.some((filter) => filter.startsWith("crop=")));
  assert.ok(!filters.some((filter) => filter.startsWith("eq=")));
  assert.equal(filters.length, 1);
  assert.match(filters[0], /^subtitles=/);
});

test(
  "render com narração mais curta que o vídeo entrega 1080x1920 e termina no áudio",
  { timeout: RENDER_TIMEOUT_MS },
  async () => {
    const baseVideo = makeBaseVideo("base_curto.mp4", 6);
    const audio = makeAudio("audio_curto.mp3", 3);
    const captionPath = writeCaptionFile(words, "curto");

    assert.ok(captionPath && existsSync(captionPath), "arquivo de legenda deveria existir");

    const result = await renderVideo({
      videoId: "curto",
      baseVideoPath: baseVideo,
      audioPath: audio,
      captionPath,
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
    const baseVideo = makeBaseVideo("base_longo.mp4", 3);
    const audio = makeAudio("audio_longo.mp3", 6);

    const result = await renderVideo({
      videoId: "longo",
      baseVideoPath: baseVideo,
      audioPath: audio,
      captionPath: writeCaptionFile(words, "longo"),
    });

    assert.ok(result.freezeSeconds > 0, "deveria congelar o último frame");

    const duration = measureDurationSeconds(result.outputPath);
    assert.ok(duration > 5.5, `a fala de 6s não pode ser cortada, veio ${duration}s`);
  },
);

test(
  "legenda queimada altera de fato os pixels do frame",
  { timeout: RENDER_TIMEOUT_MS },
  async () => {
    const baseVideo = makeBaseVideo("base_legenda.mp4", 4);
    const audio = makeAudio("audio_legenda.mp3", 3);

    const comLegenda = await renderVideo({
      videoId: "com_legenda",
      baseVideoPath: baseVideo,
      audioPath: audio,
      captionPath: writeCaptionFile(words, "com_legenda"),
    });

    const semLegenda = await renderVideo({
      videoId: "sem_legenda",
      baseVideoPath: baseVideo,
      audioPath: audio,
      captionPath: null,
    });

    const frameCom = join(workDir, "frame_com.png");
    const frameSem = join(workDir, "frame_sem.png");

    ffmpeg(["-y", "-ss", "1", "-i", comLegenda.outputPath, "-frames:v", "1", frameCom]);
    ffmpeg(["-y", "-ss", "1", "-i", semLegenda.outputPath, "-frames:v", "1", frameSem]);

    assert.notEqual(
      statSync(frameCom).size,
      statSync(frameSem).size,
      "o frame com legenda deveria diferir do frame sem legenda",
    );
  },
);
