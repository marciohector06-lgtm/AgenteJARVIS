import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import { logger } from "../logger.js";

const CONFIRMATION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

// Estado persistido no SQLite pelo mesmo motivo do killSwitch.js: garante um
// registro durável do pedido/resposta e permite que uma confirmação seja
// resolvida por fora do processo que a criou (ex.: uma futura ferramenta de
// administração). A notificação em si (Telegram/socket) continua sendo feita
// pelo listener "request" no MESMO processo que originou o pedido — é ele
// quem tem o canal (chat/app) daquela sessão aberto.
const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS confirmations (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt INTEGER NOT NULL,
    resolvedAt INTEGER
  );
`);

const insertConfirmation = db.prepare(
  "INSERT INTO confirmations (id, sessionId, description, status, createdAt) VALUES (?, ?, ?, 'pending', ?)"
);
const selectConfirmation = db.prepare("SELECT status FROM confirmations WHERE id = ?");
const updateConfirmation = db.prepare(
  "UPDATE confirmations SET status = ?, resolvedAt = ? WHERE id = ? AND status = 'pending'"
);

export const confirmationBroker = new EventEmitter();

export function requestConfirmation(sessionId, description) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  insertConfirmation.run(requestId, String(sessionId), description, Date.now());

  return new Promise((resolve) => {
    let settled = false;

    const finish = (approved) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      clearInterval(pollId);
      confirmationBroker.off(`response:${requestId}`, onResponse);
      resolve(approved);
    };

    function onResponse(approved) {
      updateConfirmation.run(approved ? "approved" : "denied", Date.now(), requestId);
      finish(approved);
    }

    // Caminho rápido: resolução chegando no MESMO processo (Telegram/app).
    confirmationBroker.once(`response:${requestId}`, onResponse);

    // Fallback: outro processo resolveu direto no SQLite (poll leve).
    const pollId = setInterval(() => {
      const row = selectConfirmation.get(requestId);
      if (row && row.status !== "pending") {
        finish(row.status === "approved");
      }
    }, POLL_INTERVAL_MS);

    const timeoutId = setTimeout(() => {
      updateConfirmation.run("denied", Date.now(), requestId);
      logger.warn(`guardExecution: confirmação expirou (timeout) para "${description}"`);
      finish(false);
    }, CONFIRMATION_TIMEOUT_MS);

    confirmationBroker.emit("request", { requestId, sessionId, description });
  });
}

export function resolveConfirmation(requestId, approved) {
  updateConfirmation.run(approved ? "approved" : "denied", Date.now(), requestId);
  confirmationBroker.emit(`response:${requestId}`, approved);
}
