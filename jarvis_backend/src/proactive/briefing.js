import cron from "node-cron";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { getRecentKnowledge } from "../memory/index.js";
import { getProfileFacts } from "../memory/profileManager.js";
import { notifyTelegram } from "./telegramNotifier.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const CRON_SCHEDULE = "0 8 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";

const briefingModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

async function invokeBriefingModel(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < briefingModels.length; i++) {
    try {
      const response = await briefingModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === briefingModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `briefing cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function yesterdayISODate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function runBriefing() {
  logger.info("briefing: iniciando geração do briefing diário");

  try {
    const knowledge = await getRecentKnowledge(yesterdayISODate());
    const pendingFacts = getProfileFacts().filter(
      (fact) => fact.category === "goals" || fact.category === "projects"
    );

    const knowledgeText = knowledge.length
      ? knowledge.map((item) => `- [${item.metadata.topic}] ${item.document.slice(0, 300)}`).join("\n")
      : "Nenhuma novidade relevante nas últimas 24h.";

    const tasksText = pendingFacts.length
      ? pendingFacts.map((fact) => `- (${fact.category}) ${fact.key}: ${fact.value}`).join("\n")
      : "Nenhuma meta/projeto registrado no perfil ainda.";

    const prompt = `Você é o J.A.R.V.I.S. gerando o briefing matinal do usuário. Seja direto e denso.

Novidades relevantes das últimas 24h (pesquisa automática):
${knowledgeText}

Metas e projetos em aberto do usuário:
${tasksText}

Gere um briefing curto (máximo 200 palavras) em português com:
1. Resumo das novidades relevantes (se houver)
2. Status rápido das metas/projetos em aberto
3. UMA sugestão de ação prioritária pra hoje

Seja objetivo, sem enrolação. Não use markdown de título, só texto corrido com quebras de linha.`;

    const briefingText = await invokeBriefingModel(prompt);
    const sent = await notifyTelegram(`☀️ Briefing do dia\n\n${briefingText}`);

    // Push notification pro app: ainda não implementado (não há registro de
    // push token de dispositivo em lugar nenhum do projeto ainda). Quando o
    // app tiver expo-notifications configurado, plugar o envio aqui.

    if (sent) {
      logger.info("briefing: enviado com sucesso");
    } else {
      logger.error("briefing: gerado mas NÃO foi entregue no Telegram");
    }
  } catch (error) {
    logger.error(`briefing: erro ao gerar/enviar: ${error.message}`);
  }
}

export function startBriefing() {
  if (process.env.BRIEFING_ENABLED !== "true") {
    logger.info("briefing: desabilitado (defina BRIEFING_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(CRON_SCHEDULE, runBriefing, { timezone: CRON_TIMEZONE });
  logger.info(`briefing: agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
}
