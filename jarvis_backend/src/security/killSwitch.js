import Database from "better-sqlite3";
import { logger } from "../logger.js";

// Estado persistido no SQLite (em vez de variável em memória) porque
// telegram.js e server.js rodam como processos Node separados — sem isso,
// ativar o kill switch por um canal não bloqueava o outro.
const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const KILL_SWITCH_KEY = "kill_switch";

const selectState = db.prepare("SELECT value FROM app_state WHERE key = ?");
const upsertState = db.prepare(`
  INSERT INTO app_state (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

export function isKillSwitchActive() {
  const row = selectState.get(KILL_SWITCH_KEY);
  return row?.value === "1";
}

export function setKillSwitch(nextActive) {
  const active = Boolean(nextActive);
  upsertState.run(KILL_SWITCH_KEY, active ? "1" : "0");
  logger.warn(`killSwitch: ${active ? "ATIVADO — tools de execução remota bloqueadas" : "DESATIVADO — tools reativadas"}`);
  return active;
}
