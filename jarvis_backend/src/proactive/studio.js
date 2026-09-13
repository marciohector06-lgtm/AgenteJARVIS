import cron from "node-cron";
import { logger } from "../logger.js";
import { pendingApprovals } from "../studio/pipeline.js";
import { offersReadyToProduce, produceVideoForOffer } from "../studio/producer.js";
import { measurePostedVideos } from "../studio/measurement.js";

const PRODUCTION_CRON = process.env.STUDIO_CRON || "0 9,15 * * *";
const MEASUREMENT_CRON = process.env.STUDIO_MEASURE_CRON || "0 22 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";

const MAX_PENDING_IN_QUEUE = 5;

let productionRunning = false;
let measurementRunning = false;

function dailyTarget() {
  return Math.max(Number.parseInt(process.env.STUDIO_DAILY_TARGET || "2", 10) || 2, 1);
}

export async function runStudioProduction() {
  if (productionRunning) {
    logger.warn("studio cron: produção anterior ainda rodando — pulando este disparo");
    return [];
  }

  productionRunning = true;

  try {
    const pending = pendingApprovals().length;

    if (pending >= MAX_PENDING_IN_QUEUE) {
      logger.info(`studio cron: ${pending} vídeos já esperando aprovação — não vou empilhar mais`);
      return [];
    }

    const offers = offersReadyToProduce();

    if (offers.length === 0) {
      logger.warn("studio cron: nenhuma oferta pronta (sem vídeo base, sem chave de voz ou tudo pausado)");
      return [];
    }

    const target = Math.min(dailyTarget(), MAX_PENDING_IN_QUEUE - pending);
    const produced = [];

    for (let i = 0; i < target; i++) {
      const offer = offers[i % offers.length];

      try {
        const video = await produceVideoForOffer(offer.id, { rotationIndex: i });
        produced.push(video);
      } catch (error) {
        logger.error(`studio cron: falha produzindo para "${offer.id}": ${error.message}`);
      }
    }

    logger.info(`studio cron: ${produced.length} vídeo(s) produzido(s) e na fila de aprovação`);
    return produced;
  } finally {
    productionRunning = false;
  }
}

export async function runStudioMeasurement() {
  if (measurementRunning) {
    logger.warn("studio cron: medição anterior ainda rodando — pulando este disparo");
    return [];
  }

  measurementRunning = true;

  try {
    return await measurePostedVideos();
  } catch (error) {
    logger.error(`studio cron: medição falhou: ${error.message}`);
    return [];
  } finally {
    measurementRunning = false;
  }
}

export function startStudio() {
  if (process.env.STUDIO_ENABLED !== "true") {
    logger.info("studio cron: desabilitado (defina STUDIO_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(PRODUCTION_CRON, runStudioProduction, { timezone: CRON_TIMEZONE });
  cron.schedule(MEASUREMENT_CRON, runStudioMeasurement, { timezone: CRON_TIMEZONE });

  logger.info(`studio cron: produção agendada ("${PRODUCTION_CRON}") e medição ("${MEASUREMENT_CRON}"), timezone ${CRON_TIMEZONE}`);
}
