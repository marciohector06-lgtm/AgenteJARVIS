import cron from "node-cron";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { getHistorySince, getRecentKnowledge } from "../memory/index.js";
import { notifyWhatsApp, getPrimaryUserId } from "./whatsappNotifier.js";
import { metaAdsTool } from "../tools/metaAdsTool.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const CRON_SCHEDULE = "0 20 * * 0"; // domingo 20:00
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

function isoDateDaysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function summarizeInsights(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { spend: 0, avgCpm: 0, avgCtr: 0 };
  const spend = rows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);
  const avgCpm = rows.reduce((sum, r) => sum + (Number(r.cpm) || 0), 0) / rows.length;
  const avgCtr = rows.reduce((sum, r) => sum + (Number(r.ctr) || 0), 0) / rows.length;
  return { spend, avgCpm, avgCtr };
}

function formatComparison(current, previous) {
  const pctChange = (curr, prev) => (prev === 0 ? "N/A" : `${(((curr - prev) / prev) * 100).toFixed(1)}%`);
  return `Gasto: R$${current.spend.toFixed(2)} (semana anterior: R$${previous.spend.toFixed(2)}, variação ${pctChange(current.spend, previous.spend)})
CPM médio: R$${current.avgCpm.toFixed(2)} (semana anterior: R$${previous.avgCpm.toFixed(2)}, variação ${pctChange(current.avgCpm, previous.avgCpm)})
CTR médio: ${current.avgCtr.toFixed(2)}% (semana anterior: ${previous.avgCtr.toFixed(2)}%, variação ${pctChange(current.avgCtr, previous.avgCtr)})`;
}

async function getMetaAdsWeeklyComparison() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    return "Meta Ads não configurado (META_ACCESS_TOKEN/META_AD_ACCOUNT_ID ausentes no .env).";
  }

  try {
    const raw = await metaAdsTool.invoke({
      action: "compare_periods",
      since: isoDateDaysAgo(7),
      until: isoDateDaysAgo(1),
      sinceB: isoDateDaysAgo(14),
      untilB: isoDateDaysAgo(8),
    });
    const { periodA, periodB } = JSON.parse(raw);
    return formatComparison(summarizeInsights(periodA.data), summarizeInsights(periodB.data));
  } catch (error) {
    logger.error(`weekly: erro ao comparar Meta Ads semana a semana: ${error.message}`);
    return `Erro ao buscar comparativo Meta Ads: ${error.message}`;
  }
}

export async function runWeekly() {
  logger.info("weekly: gerando relatório semanal");

  try {
    const userId = getPrimaryUserId();
    if (!userId) {
      logger.warn("weekly: WHATSAPP_OWNER_NUMBER não configurado, abortando");
      return;
    }

    const weekAgo = Date.now() - WEEK_MS;
    const [history, knowledge, metaAdsComparison] = await Promise.all([
      Promise.resolve(getHistorySince(userId, weekAgo)),
      getRecentKnowledge(new Date(weekAgo).toISOString().slice(0, 10)),
      getMetaAdsWeeklyComparison(),
    ]);

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

Meta Ads — comparativo desta semana vs semana anterior:
${metaAdsComparison}

Gere um relatório semanal (máximo 350 palavras) com:
1. O que foi conversado/resolvido essa semana (resumo objetivo)
2. Principais novidades que o scraper aprendeu
3. Resumo do comparativo de Meta Ads (o que melhorou/piorou)
4. Sugestão de ajustes concretos nas campanhas, se aplicável
5. 3 prioridades sugeridas pra semana que vem

Seja direto, sem enrolação.`;

    const reportText = await invokeWeeklyModel(prompt);
    const sent = await notifyWhatsApp(`📊 Relatório semanal\n\n${reportText}`);

    if (sent) {
      logger.info("weekly: enviado com sucesso");
    } else {
      logger.error("weekly: gerado mas NÃO foi entregue no WhatsApp");
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
  logger.info(`weekly: agendado (domingo 20:00, timezone ${CRON_TIMEZONE})`);
}
