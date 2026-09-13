import "dotenv/config";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { createOffer, getOffer } from "../src/studio/offers.js";
import { budgetForBaseVideo } from "../src/studio/baseVideos.js";
import { generateScript } from "../src/studio/scriptWriter.js";
import { renderVideo } from "../src/studio/render.js";
import * as pipeline from "../src/studio/pipeline.js";
import { BASE_VIDEOS_DIR, AUDIO_DIR, ensureStudioDirs } from "../src/studio/paths.js";

const OFFER_ID = "magnesio-inositol";
const SOURCE_VIDEO = process.argv[2];

if (!SOURCE_VIDEO || !existsSync(SOURCE_VIDEO)) {
  console.error("Uso: node scripts/studioSmoke.mjs <caminho-do-video-base.mp4>");
  process.exit(1);
}

ensureStudioDirs();

const offer =
  getOffer(OFFER_ID) ||
  createOffer({
    id: OFFER_ID,
    productName:
      "Magnésio & Inositol Body Action sabor Maracujá — pó com bisglicinato de magnésio, " +
      "mio-inositol e melatonina, 7g por dose, tomado 30 minutos antes de dormir",
    category: "Suplementos / Saúde e Bem-estar",
    link: "https://www.tiktok.com/@bodyaction",
    commission: 15,
    hashtags: ["magnesio", "inositol", "sono", "tiktokshopbrasil"],
  });

console.log(`oferta: ${offer.productName.slice(0, 60)}...`);

const offerDir = join(BASE_VIDEOS_DIR, OFFER_ID);
mkdirSync(offerDir, { recursive: true });

const baseVideo = join(offerDir, "base_01.mp4");
if (!existsSync(baseVideo)) copyFileSync(SOURCE_VIDEO, baseVideo);

const budget = budgetForBaseVideo(baseVideo);
console.log(`budget: ${budget.durationSeconds.toFixed(2)}s -> ${budget.maxNarrationSeconds}s de fala, ${budget.minCharBudget}-${budget.charBudget} chars, ${budget.sceneCount} cena(s)`);

const video = pipeline.createVideo({ offerId: OFFER_ID, baseVideoPath: baseVideo });

console.log("\ngerando roteiro no Gemini...");
const { script, hookFormula, sceneFormat, narrationChars } = await generateScript({ offer, budget });

console.log(`\nHOOK:    "${script.hook}"`);
script.scenes.forEach((s) => console.log(`CENA ${s.number}: ${s.narration}`));
console.log(`CTA:     "${script.cta}"`);
console.log(`CAPTION: ${script.caption}`);
console.log(`\nfórmula de gancho: ${hookFormula}`);
console.log(`formato de cenas : ${sceneFormat}`);
console.log(`narração: ${narrationChars} chars (alvo ${budget.minCharBudget}-${budget.charBudget}) ${narrationChars >= budget.minCharBudget && narrationChars <= budget.charBudget ? "DENTRO DA FAIXA" : "FORA DA FAIXA"}`);

const audioPath = join(AUDIO_DIR, `audio_${video.id}.mp3`);
execFileSync(
  ffmpegPath,
  ["-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${budget.maxNarrationSeconds}`, "-b:a", "192k", audioPath],
  { stdio: "ignore" },
);
console.log("\naudio: tom sintético (sem ELEVENLABS_API_KEY ainda)");

const rendered = await renderVideo({
  videoId: video.id,
  baseVideoPath: baseVideo,
  audioPath,
  rotationIndex: 0,
});

pipeline.transition(video.id, pipeline.STATES.RENDERED, {
  script,
  hookFormula,
  sceneFormat,
  audioPath,
  videoPath: rendered.outputPath,
});

pipeline.submitForApproval(video.id);

console.log(`\nvídeo ${video.id} na fila de aprovação (${rendered.sizeMB.toFixed(1)}MB)`);
console.log("confira em GET /api/v1/studio/pending");
