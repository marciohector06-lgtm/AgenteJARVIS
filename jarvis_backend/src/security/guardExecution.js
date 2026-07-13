import { logger } from "../logger.js";
import { getCurrentSessionId } from "./sessionContext.js";
import { requestConfirmation } from "./confirmationBroker.js";

const DESTRUCTIVE_PATTERNS = [
  /\bkill\b/i,
  /\btaskkill\b/i,
  /\brm\b/i,
  /\bdel\b/i,
  /\bremove-item\b/i,
  /\bshutdown\b/i,
  /\brestart-computer\b/i,
  /\breboot\b/i,
  /\bformat\b/i,
  /\bfirewall\b.*\b(add|drop|delete)\b/i,
  /\bnetsh\b.*\bfirewall\b/i,
  /\bvlan\b.*\b(create|delete|remove|add)\b/i,
  /\bqos\b/i,
];

export function isDestructiveCommand(command) {
  return DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
}

export async function guardExecution(description, { destructive = false } = {}, executeFn) {
  const sessionId = getCurrentSessionId();

  if (destructive && process.env.REQUIRE_CONFIRM === "true") {
    logger.warn(
      `guardExecution: comando destrutivo aguardando confirmação: "${description}" (sessionId=${sessionId})`
    );

    const approved = await requestConfirmation(sessionId, description);

    if (!approved) {
      logger.warn(`guardExecution: comando destrutivo NEGADO/expirado: "${description}"`);
      return "Comando cancelado: confirmação não recebida ou negada pelo usuário.";
    }

    logger.info(`guardExecution: comando destrutivo CONFIRMADO: "${description}"`);
  }

  logger.info(
    `guardExecution: executando "${description}" (destructive=${destructive}, sessionId=${sessionId})`
  );

  const result = await executeFn();

  logger.info(`guardExecution: execução concluída para "${description}"`);
  return result;
}
