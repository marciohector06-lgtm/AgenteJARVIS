import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ToolMessage } from "@langchain/core/messages";
import { tools } from "../tools/index.js";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "./modelFallback.js";

const modelsByName = new Map(
  MODEL_FALLBACK_CHAIN.map((name) => [
    name,
    new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model: name }).bindTools(
      tools
    ),
  ])
);

let activeModelIndex = 0;

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

export async function runToolLoop(messages) {
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

  return { response, messages };
}

export { toolsByName };
