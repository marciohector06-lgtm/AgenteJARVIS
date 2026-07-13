import cron from "node-cron";
import { TavilySearch } from "@langchain/tavily";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { saveKnowledge } from "../memory/index.js";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/index.js";

const CRON_SCHEDULE = "0 2 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";

const tavilySearch = new TavilySearch({ maxResults: 3 });

const summarizerModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

function currentMonthAndYear() {
  const now = new Date();
  const month = now.toLocaleString("pt-BR", { month: "long", timeZone: CRON_TIMEZONE });
  const year = now.toLocaleString("pt-BR", { year: "numeric", timeZone: CRON_TIMEZONE });
  return { month, year };
}

function buildQueries() {
  const { month, year } = currentMonthAndYear();

  return [
    { topic: "meta_ads", query: `Meta Business Blog ads update ${month} ${year}` },
    { topic: "tiktok_shop", query: `TikTok Shop news ${month} ${year}` },
    { topic: "google_ads_pmax", query: `Google Ads Performance Max changes ${month} ${year}` },
    { topic: "owasp_top10", query: `OWASP Top 10 ${year}` },
    { topic: "network_defense", query: "network infrastructure defense best practices" },
  ];
}

async function summarize(query, results) {
  const sources = results
    .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.content}`)
    .join("\n\n");

  const prompt = `Resuma em português, de forma objetiva (máximo 200 palavras), as novidades e pontos relevantes sobre "${query}" com base nestas fontes:\n\n${sources}`;
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < summarizerModels.length; i++) {
    try {
      const response = await summarizerModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === summarizerModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `knowledge_scraper cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function runQuery({ topic, query }) {
  try {
    const response = await tavilySearch.invoke({ query });
    const parsed = typeof response === "string" ? JSON.parse(response) : response;
    const results = (parsed.results || []).slice(0, 3);

    if (results.length === 0) {
      logger.warn(`knowledge_scraper topic=${topic} query="${query}" resultado=sem_resultados`);
      return;
    }

    const summary = await summarize(query, results);
    const date = new Date().toISOString().slice(0, 10);
    const source = results.map((r) => r.url).join(", ");

    await saveKnowledge(summary, { source, topic, date });
    logger.info(`knowledge_scraper topic=${topic} query="${query}" resultado=ok fontes=${results.length}`);
  } catch (error) {
    logger.error(`knowledge_scraper topic=${topic} query="${query}" erro=${error.message}`);
  }
}

export async function runKnowledgeScraper() {
  logger.info("knowledge_scraper iniciando execução");
  const queries = buildQueries();

  for (const item of queries) {
    await runQuery(item);
  }

  logger.info("knowledge_scraper execução concluída");
}

export function startKnowledgeScraper() {
  cron.schedule(CRON_SCHEDULE, runKnowledgeScraper, { timezone: CRON_TIMEZONE });
  logger.info(
    `knowledge_scraper agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`
  );
}
