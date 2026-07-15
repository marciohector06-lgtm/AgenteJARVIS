import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { runToolLoop } from "./toolLoop.js";
import { logger } from "../logger.js";

const EXECUTOR_SYSTEM_PROMPT =
  "Você é o executor de um plano multi-etapas do J.A.R.V.I.S. Execute APENAS o passo pedido agora, usando as tools necessárias quando fizer sentido. Seja objetivo — o resultado deste passo vai alimentar o próximo.";

async function runStep(originalTask, step, accumulatedContext) {
  const stepPrompt = `Tarefa original do usuário: ${originalTask}

Você está executando o passo ${step.step} de um plano multi-etapas.
Objetivo deste passo: ${step.reason}
${step.tool ? `Tool sugerida para este passo: ${step.tool}` : "Este passo não precisa de tool, é raciocínio/análise."}
${accumulatedContext ? `\nContexto acumulado dos passos anteriores:\n${accumulatedContext}` : ""}

Execute este passo específico e retorne o resultado de forma objetiva.`;

  const messages = [new SystemMessage(EXECUTOR_SYSTEM_PROMPT), new HumanMessage(stepPrompt)];
  const { response } = await runToolLoop(messages);
  return response.content;
}

async function synthesizeFinalAnswer(originalTask, results) {
  const summaryPrompt = `Tarefa original do usuário: ${originalTask}

Resultados de cada passo executado:
${results.map((r) => `Passo ${r.step} (${r.reason}): ${r.result}`).join("\n\n")}

Com base nesses resultados, dê a resposta final consolidada para a tarefa original do usuário. Seja direto e objetivo.`;

  const messages = [new HumanMessage(summaryPrompt)];
  const { response } = await runToolLoop(messages);
  return response.content;
}

export async function executePlan(originalTask, steps, { onStepDone } = {}) {
  const results = [];
  let accumulatedContext = "";
  let failedStep = null;

  for (const step of steps) {
    try {
      const result = await runStep(originalTask, step, accumulatedContext);
      const stepResult = { step: step.step, reason: step.reason, tool: step.tool, result, status: "ok" };

      results.push(stepResult);
      accumulatedContext += `\nPasso ${step.step} (${step.reason}): ${result}`;
      logger.info(`executor: passo ${step.step} concluído`);
      onStepDone?.(stepResult);
    } catch (error) {
      const stepResult = {
        step: step.step,
        reason: step.reason,
        tool: step.tool,
        result: null,
        status: "error",
        error: error.message,
      };

      results.push(stepResult);
      logger.error(`executor: passo ${step.step} falhou: ${error.message}`);
      onStepDone?.(stepResult);
      failedStep = step.step;
      break;
    }
  }

  if (failedStep) {
    const completedCount = results.filter((r) => r.status === "ok").length;
    return {
      steps: results,
      finalAnswer: `Parei no passo ${failedStep} por um erro: ${
        results[results.length - 1].error
      }. ${completedCount} de ${steps.length} passo(s) foram concluídos antes disso.`,
    };
  }

  const finalAnswer = await synthesizeFinalAnswer(originalTask, results);
  return { steps: results, finalAnswer };
}
