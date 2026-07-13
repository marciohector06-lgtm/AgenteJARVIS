import { AsyncLocalStorage } from "node:async_hooks";

const sessionContext = new AsyncLocalStorage();

export function runWithSession(sessionId, fn) {
  return sessionContext.run({ sessionId }, fn);
}

export function getCurrentSessionId() {
  return sessionContext.getStore()?.sessionId;
}
