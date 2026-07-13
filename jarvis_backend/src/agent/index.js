import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { recallMemory, saveMemory, getHistory } from "../memory/index.js";
import { tools } from "../tools/index.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { logger } from "../logger.js";
import { runWithSession } from "../security/sessionContext.js";

export const MODEL_FALLBACK_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
];

const modelsByName = new Map(
  MODEL_FALLBACK_CHAIN.map((name) => [
    name,
    new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model: name }).bindTools(
      tools
    ),
  ])
);

let activeModelIndex = 0;

export function isQuotaError(error) {
  return error?.status === 429 || /quota|rate.?limit/i.test(error?.message || "");
}

async function invokeWithFallback(messages) {
  for (let i = activeModelIndex; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const modelName = MODEL_FALLBACK_CHAIN[i];
    try {
      const response = await modelsByName.get(modelName).invoke(messages);
      activeModelIndex = i;
      return response;
    } catch (error) {
      const isLastModel = i === MODEL_FALLBACK_CHAIN.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(`Cota esgotada em "${modelName}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`);
        continue;
      }
      throw error;
    }
  }
}

const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));

export async function askAgent(userId, message) {
  return runWithSession(userId, async () => {
    const recentHistory = getHistory(userId, 6);
    const knowledge = await recallMemory(message);

    const historyBlock = recentHistory.length
      ? `Histórico recente da conversa:\n${recentHistory
          .map((turn) => `${turn.role}: ${turn.text}`)
          .join("\n")}`
      : "";

    const knowledgeBlock = knowledge.length
      ? `Conhecimento relevante:\n${knowledge.map((item) => `- ${item}`).join("\n")}`
      : "";

    const contextBlock = [historyBlock, knowledgeBlock].filter(Boolean).join("\n\n");

    const prompt = contextBlock
      ? `${contextBlock}\n\nMensagem atual do usuário: ${message}`
      : message;

    const messages = [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(prompt)];

    let response = await invokeWithFallback(messages);
    messages.push(response);

    while (response.tool_calls?.length) {
      for (const toolCall of response.tool_calls) {
        const selectedTool = toolsByName[toolCall.name];
        const result = selectedTool
          ? await selectedTool.invoke(toolCall.args)
          : `Ferramenta "${toolCall.name}" não encontrada.`;

        messages.push(
          new ToolMessage({
            content: String(result),
            tool_call_id: toolCall.id,
          })
        );
      }

      response = await invokeWithFallback(messages);
      messages.push(response);
    }

    await saveMemory(userId, "user", message);
    await saveMemory(userId, "assistant", response.content);

    return response.content;
  });
}
