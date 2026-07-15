import cron from "node-cron";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { getHistorySince, getRecentKnowledge } from "../memory/index.js";
import { notifyTelegram, getPrimaryUserId } from "./telegramNotifier.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const CRON_SCHEDULE = "0 17 * * 5"; // sexta-feira 17:00
const CRON_TIMEZONE = "America/Sao_Paulo";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const weeklyModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

async function invokeWeeklyModel(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < weeklyModels.length; i++) {
    try {
      const response = await weeklyModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === weeklyModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `weekly cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function runWeekly() {
  logger.info("weekly: gerando relatório semanal");

  try {
    const userId = getPrimaryUserId();
    if (!userId) {
      logger.warn("weekly: nenhum ALLOWED_TELEGRAM_USER_IDS configurado, abortando");
      return;
    }

    const weekAgo = Date.now() - WEEK_MS;
    const history = getHistorySince(userId, weekAgo);
    const knowledge = await getRecentKnowledge(new Date(weekAgo).toISOString().slice(0, 10));

    const conversationText = history.length
      ? history
          .map((turn) => `${turn.role}: ${turn.text}`)
          .join("\n")
          .slice(0, 8000)
      : "Nenhuma conversa registrada essa semana.";

    const knowledgeText = knowledge.length
      ? knowledge.map((item) => `- [${item.metadata.topic}] ${item.document.slice(0, 200)}`).join("\n")
      : "Nenhuma novidade relevante essa semana.";

    const prompt = `Você é o J.A.R.V.I.S. gerando o relatório semanal do usuário.

Conversas da semana (histórico bruto):
${conversationText}

Conhecimento que o scraper coletou essa semana:
${knowledgeText}

Gere um relatório semanal (máximo 300 palavras) com:
1. O que foi conversado/resolvido essa semana (resumo objetivo)
2. Principais novidades que o scraper aprendeu
3. 3 prioridades sugeridas pra semana que vem

Seja direto, sem enrolação.`;

    const reportText = await invokeWeeklyModel(prompt);
    const sent = await notifyTelegram(`📊 Relatório semanal\n\n${reportText}`);

    if (sent) {
      logger.info("weekly: enviado com sucesso");
    } else {
      logger.error("weekly: gerado mas NÃO foi entregue no Telegram");
    }
  } catch (error) {
    logger.error(`weekly: erro: ${error.message}`);
  }
}

export function startWeekly() {
  if (process.env.WEEKLY_ENABLED !== "true") {
    logger.info("weekly: desabilitado (defina WEEKLY_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(CRON_SCHEDULE, runWeekly, { timezone: CRON_TIMEZONE });
  logger.info(`weekly: agendado (sexta 17:00, timezone ${CRON_TIMEZONE})`);
}
