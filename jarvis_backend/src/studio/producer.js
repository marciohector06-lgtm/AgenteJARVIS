import { logger } from "../logger.js";
import { getOffer, listOffers } from "./offers.js";
import { selectBaseVideo, budgetForBaseVideo } from "./baseVideos.js";
import { generateScript } from "./scriptWriter.js";
import { generateVoice } from "./voice.js";
import { renderVideo } from "./render.js";
import { searchMinedHooks } from "./hookStore.js";
import * as pipeline from "./pipeline.js";

export function offerReadiness(offerId) {
  const offer = getOffer(offerId);
  if (!offer) return { ready: false, reason: `Oferta "${offerId}" não existe.` };
  if (!offer.active) return { ready: false, reason: `Oferta "${offerId}" está pausada.` };

  try {
    selectBaseVideo(offerId, 0);
  } catch (error) {
    return { ready: false, reason: error.message };
  }

  if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    return { ready: false, reason: "ELEVENLABS_API_KEY/ELEVENLABS_VOICE_ID ausentes — sem voz não há vídeo." };
  }

  if (!process.env.GEMINI_API_KEY) {
    return { ready: false, reason: "GEMINI_API_KEY ausente — sem roteiro não há vídeo." };
  }

  return { ready: true, offer };
}

export async function produceVideoForOffer(offerId, { rotationIndex = 0 } = {}) {
  const readiness = offerReadiness(offerId);
  if (!readiness.ready) throw new Error(readiness.reason);

  const { offer } = readiness;
  const baseVideoPath = selectBaseVideo(offerId, rotationIndex);
  const budget = budgetForBaseVideo(baseVideoPath);

  const video = pipeline.createVideo({ offerId, baseVideoPath });
  logger.info(`studio producer: ${video.id} — ${offer.productName.slice(0, 50)} (${budget.maxNarrationSeconds}s, ${budget.sceneCount} cena(s))`);

  try {
    const minedHooks = await searchMinedHooks(offer.category, { limit: 6 });

    const { script, hookFormula, sceneFormat, narrationChars, withinBudget } = await generateScript({
      offer,
      budget,
      minedHooks,
    });

    if (!withinBudget) {
      logger.warn(`studio producer: ${video.id} saiu com ${narrationChars} chars (alvo ${budget.minCharBudget}-${budget.charBudget})`);
    }

    const { audioPath } = await generateVoice(script, video.id);

    const rendered = await renderVideo({
      videoId: video.id,
      baseVideoPath,
      audioPath,
      rotationIndex,
    });

    pipeline.transition(video.id, pipeline.STATES.RENDERED, {
      script,
      hookFormula,
      sceneFormat,
      audioPath,
      videoPath: rendered.outputPath,
    });

    pipeline.submitForApproval(video.id);

    logger.info(`studio producer: ${video.id} pronto e na fila (${rendered.sizeMB.toFixed(1)}MB)`);

    return pipeline.getVideo(video.id);
  } catch (error) {
    pipeline.markFailed(video.id, error);
    logger.error(`studio producer: ${video.id} falhou — ${error.message}`);
    throw error;
  }
}

export function offersReadyToProduce() {
  return listOffers({ activeOnly: true }).filter((offer) => offerReadiness(offer.id).ready);
}
