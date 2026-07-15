import cron from "node-cron";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { getProfileFacts } from "../memory/profileManager.js";
import { notifyTelegram } from "./telegramNotifier.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const CRON_SCHEDULE = "0 18 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";
const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias sem atualização = "parado"

const followupModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

async function invokeFollowupModel(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < followupModels.length; i++) {
    try {
      const response = await followupModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === followupModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `followup cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function runFollowup() {
  logger.info("followup: verificando tarefas paradas");

  try {
    const facts = getProfileFacts().filter((fact) => fact.category === "goals" || fact.category === "projects");
    const now = Date.now();
    const stale = facts.filter((fact) => now - fact.updatedAt > STALE_THRESHOLD_MS);

    if (stale.length === 0) {
      logger.info("followup: nenhuma tarefa parada encontrada, nada a enviar");
      return;
    }

    const listText = stale
      .map((fact) => {
        const days = Math.floor((now - fact.updatedAt) / 86_400_000);
        return `- (${fact.category}) ${fact.key}: ${fact.value} (sem atualização há ${days} dia(s))`;
      })
      .join("\n");

    const prompt = `Você é o J.A.R.V.I.S. Estas metas/projetos do usuário estão sem atualização há alguns dias:

${listText}

Escreva uma mensagem curta e direta (máximo 100 palavras) cobrando gentilmente o progresso, sem ser passivo-agressivo — o foco é ajudar a destravar, não culpar.`;

    const text = await invokeFollowupModel(prompt);
    const sent = await notifyTelegram(`📋 Follow-up\n\n${text}`);

    if (sent) {
      logger.info(`followup: enviado, ${stale.length} item(ns) parado(s)`);
    } else {
      logger.error("followup: gerado mas NÃO foi entregue no Telegram");
    }
  } catch (error) {
    logger.error(`followup: erro: ${error.message}`);
  }
}

export function startFollowup() {
  if (process.env.FOLLOWUP_ENABLED !== "true") {
    logger.info("followup: desabilitado (defina FOLLOWUP_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(CRON_SCHEDULE, runFollowup, { timezone: CRON_TIMEZONE });
  logger.info(`followup: agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
}
