import { EventEmitter } from "node:events";
import { logger } from "../logger.js";

const CONFIRMATION_TIMEOUT_MS = 120_000;

export const confirmationBroker = new EventEmitter();

export function requestConfirmation(sessionId, description) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      confirmationBroker.off(`response:${requestId}`, onResponse);
      logger.warn(`guardExecution: confirmação expirou (timeout) para "${description}"`);
      resolve(false);
    }, CONFIRMATION_TIMEOUT_MS);

    function onResponse(approved) {
      clearTimeout(timeoutId);
      resolve(approved);
    }

    confirmationBroker.once(`response:${requestId}`, onResponse);
    confirmationBroker.emit("request", { requestId, sessionId, description });
  });
}

export function resolveConfirmation(requestId, approved) {
  confirmationBroker.emit(`response:${requestId}`, approved);
}
