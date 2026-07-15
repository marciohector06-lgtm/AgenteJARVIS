import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { tools } from "../tools/index.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "./modelFallback.js";

const plannerModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

const toolNames = tools.map((t) => t.name);

const PLANNER_PROMPT_TEMPLATE = `Você é o planejador do J.A.R.V.I.S. Analise a tarefa do usuário abaixo e decida entre duas opções:

1. Se é uma pergunta ou pedido SIMPLES (resolve com uma resposta direta ou no máximo 1 tool), responda APENAS com este JSON:
{"isComplex": false}

2. Se é uma tarefa COMPLEXA que precisa de múltiplos passos em sequência, onde o resultado de um passo alimenta o próximo (ex: pesquisar algo, depois calcular algo com o resultado, depois comparar/decidir), quebre em passos ordenados e responda APENAS com este JSON:
{"isComplex": true, "steps": [{"step": 1, "tool": "nome_da_tool_ou_null", "reason": "o que esse passo faz e por quê"}]}

Tools disponíveis: __TOOL_NAMES__
Use SOMENTE nomes de tools dessa lista no campo "tool". Se um passo for só raciocínio/comparação/decisão final (sem precisar de tool), use "tool": null.

Responda APENAS com o JSON puro, sem markdown, sem texto adicional.

Tarefa do usuário: __TASK__`;

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function invokePlanner(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < plannerModels.length; i++) {
    try {
      const response = await plannerModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === plannerModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `planner cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function planTask(task) {
  const prompt = PLANNER_PROMPT_TEMPLATE.replace("__TOOL_NAMES__", toolNames.join(", ")).replace(
    "__TASK__",
    task
  );

  const raw = await invokePlanner(prompt);
  const parsed = extractJson(raw);

  if (!parsed.isComplex) {
    return { isComplex: false };
  }

  const steps = (parsed.steps || []).map((step, index) => ({
    step: step.step ?? index + 1,
    tool: step.tool && toolNames.includes(step.tool) ? step.tool : null,
    reason: step.reason || "",
  }));

  logger.info(`planner: tarefa complexa detectada, ${steps.length} passo(s) planejado(s)`);
  return { isComplex: true, steps };
}
