import { guardExecution } from "../security/guardExecution.js";
import { runWithSession } from "../security/sessionContext.js";
import { API_SESSION_ID } from "./requireDeviceJwt.js";

export async function runGuarded(description, { confirmed = false } = {}, executeFn) {
  const outcome = await runWithSession(API_SESSION_ID, () =>
    guardExecution(description, { destructive: !confirmed }, async () => ({
      executedByApi: true,
      value: await executeFn(),
    }))
  );

  if (outcome && typeof outcome === "object" && outcome.executedByApi === true) {
    return { blocked: false, result: outcome.value };
  }

  return {
    blocked: true,
    reason: typeof outcome === "string" ? outcome : "Execução bloqueada pela camada de segurança do JARVIS.",
  };
}

export function respondBlocked(res, reason) {
  return res.status(409).json({ blocked: true, reason });
}
