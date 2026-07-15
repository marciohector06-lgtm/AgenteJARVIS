import Database from "better-sqlite3";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS user_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.8,
    updatedAt INTEGER NOT NULL,
    UNIQUE(category, key)
  );
`);

const upsertFact = db.prepare(`
  INSERT INTO user_profile (category, key, value, confidence, updatedAt)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(category, key) DO UPDATE SET
    value = excluded.value,
    confidence = excluded.confidence,
    updatedAt = excluded.updatedAt
`);

const selectAll = db.prepare(
  "SELECT category, key, value, confidence, updatedAt FROM user_profile ORDER BY category, key"
);

export function updateProfile(category, key, value, confidence = 0.8) {
  upsertFact.run(category, key, value, confidence, Date.now());
  logger.info(`profileManager: atualizado ${category}.${key}`);
}

export function getProfileFacts() {
  return selectAll.all();
}

export function getProfile() {
  const facts = getProfileFacts();
  if (facts.length === 0) return "";

  const byCategory = {};
  for (const fact of facts) {
    (byCategory[fact.category] ||= []).push(`${fact.key}: ${fact.value}`);
  }

  const sections = Object.entries(byCategory).map(
    ([category, items]) => `${category}:\n${items.map((item) => `- ${item}`).join("\n")}`
  );

  return `Perfil conhecido do usuário:\n${sections.join("\n\n")}`;
}

const extractorModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

const EXTRACTION_PROMPT_TEMPLATE = `Analise a troca de mensagens abaixo entre um usuário e o assistente J.A.R.V.I.S. Identifique fatos NOVOS ou ATUALIZADOS sobre o usuário nas categorias: goals (metas), projects (projetos), preferences (preferências), decisions (decisões), context (contexto geral).

Responda APENAS com um JSON válido (array, sem markdown, sem texto adicional), neste formato:
[{ "category": "projects", "key": "chave_curta_sem_espacos", "value": "descrição objetiva do fato", "confidence": 0.9 }]

Se não houver fatos novos ou relevantes o suficiente, responda com um array vazio: []
Não invente informação que não esteja explícita ou fortemente implícita na conversa.

Usuário: __USER_MESSAGE__
J.A.R.V.I.S.: __ASSISTANT_REPLY__`;

function extractJsonArray(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function runExtraction(userMessage, assistantReply) {
  const prompt = EXTRACTION_PROMPT_TEMPLATE.replace("__USER_MESSAGE__", userMessage).replace(
    "__ASSISTANT_REPLY__",
    assistantReply
  );
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < extractorModels.length; i++) {
    try {
      const response = await extractorModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === extractorModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `profileManager extractor cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export function extractProfileUpdates(userId, userMessage, assistantReply) {
  runExtraction(userMessage, assistantReply)
    .then((raw) => {
      const facts = extractJsonArray(raw);
      if (!Array.isArray(facts) || facts.length === 0) return;

      for (const fact of facts) {
        if (!fact.category || !fact.key || !fact.value) continue;
        updateProfile(fact.category, fact.key, fact.value, fact.confidence ?? 0.8);
      }

      logger.info(`profileManager: extrator encontrou ${facts.length} fato(s) para userId=${userId}`);
    })
    .catch((error) => {
      logger.error(`profileManager: erro no extrator (userId=${userId}): ${error.message}`);
    });
}
