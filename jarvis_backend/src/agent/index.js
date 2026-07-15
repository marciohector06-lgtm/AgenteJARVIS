import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { recallMemory, saveMemory, getHistory } from "../memory/index.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";
import { runWithSession } from "../security/sessionContext.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "./modelFallback.js";
import { getProfile, extractProfileUpdates } from "../memory/profileManager.js";
import { runToolLoop } from "./toolLoop.js";
import { planTask } from "./planner.js";
import { executePlan } from "./executor.js";

export { MODEL_FALLBACK_CHAIN, isQuotaError };

export async function askAgent(userId, message, callbacks = {}) {
  return runWithSession(userId, async () => {
    const recentHistory = getHistory(userId, 6);
    const knowledge = await recallMemory(message);
    const profile = getProfile();

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

    const plan = await planTask(message);

    if (plan.isComplex) {
      callbacks.onPlan?.(plan.steps);

      const { steps, finalAnswer } = await executePlan(message, plan.steps, {
        onStepDone: callbacks.onStepDone,
      });

      await saveMemory(userId, "user", message);
      await saveMemory(userId, "assistant", finalAnswer);
      extractProfileUpdates(userId, message, finalAnswer);

      return finalAnswer;
    }

    const systemContent = profile ? `${SYSTEM_PROMPT}\n\n${profile}` : SYSTEM_PROMPT;
    const messages = [new SystemMessage(systemContent), new HumanMessage(prompt)];

    const { response } = await runToolLoop(messages);

    await saveMemory(userId, "user", message);
    await saveMemory(userId, "assistant", response.content);

    extractProfileUpdates(userId, message, response.content);

    return response.content;
  });
}
