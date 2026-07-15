import { logger } from "../logger.js";

let active = false;

export function isKillSwitchActive() {
  return active;
}

export function setKillSwitch(nextActive) {
  active = Boolean(nextActive);
  logger.warn(`killSwitch: ${active ? "ATIVADO — tools de execução remota bloqueadas" : "DESATIVADO — tools reativadas"}`);
  return active;
}
