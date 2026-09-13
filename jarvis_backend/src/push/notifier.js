import Database from "better-sqlite3";
import { logger } from "../logger.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY,
    platform TEXT,
    registeredAt INTEGER NOT NULL,
    lastUsedAt INTEGER,
    failures INTEGER NOT NULL DEFAULT 0
  );
`);

const upsertToken = db.prepare(`
  INSERT INTO push_tokens (token, platform, registeredAt, failures)
  VALUES (@token, @platform, @registeredAt, 0)
  ON CONFLICT(token) DO UPDATE SET platform = @platform, failures = 0
`);
const selectTokens = db.prepare("SELECT token FROM push_tokens WHERE failures < 3");
const markUsed = db.prepare("UPDATE push_tokens SET lastUsedAt = ? WHERE token = ?");
const markFailure = db.prepare("UPDATE push_tokens SET failures = failures + 1 WHERE token = ?");
const deleteToken = db.prepare("DELETE FROM push_tokens WHERE token = ?");

export function isValidExpoToken(token) {
  return EXPO_TOKEN_PATTERN.test(String(token || "").trim());
}

export function registerPushToken(token, platform = "android") {
  const clean = String(token || "").trim();

  if (!isValidExpoToken(clean)) {
    throw new Error("Token de push inválido — esperado no formato ExponentPushToken[...].");
  }

  upsertToken.run({ token: clean, platform, registeredAt: Date.now() });
  logger.info(`push: token registrado (${platform})`);

  return { token: clean, platform };
}

export function listPushTokens() {
  return selectTokens.all().map((row) => row.token);
}

export function forgetPushToken(token) {
  deleteToken.run(String(token || "").trim());
}

export async function sendPush({ title, body, data = {} }) {
  const tokens = listPushTokens();

  if (tokens.length === 0) {
    logger.info("push: nenhum dispositivo registrado — notificação não enviada");
    return { sent: 0 };
  }

  const mensagens = tokens.map((token) => ({
    to: token,
    title,
    body,
    data,
    sound: "default",
    priority: "high",
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(mensagens),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.error(`push: Expo respondeu ${response.status}: ${detail.slice(0, 160)}`);
      return { sent: 0, error: `HTTP ${response.status}` };
    }

    const payload = await response.json();
    const tickets = Array.isArray(payload.data) ? payload.data : [];

    let enviados = 0;

    tickets.forEach((ticket, index) => {
      const token = tokens[index];

      if (ticket.status === "ok") {
        enviados++;
        markUsed.run(Date.now(), token);
        return;
      }

      logger.warn(`push: token recusado (${ticket.details?.error || ticket.message || "motivo desconhecido"})`);

      if (ticket.details?.error === "DeviceNotRegistered") forgetPushToken(token);
      else markFailure.run(token);
    });

    logger.info(`push: ${enviados}/${tokens.length} notificação(ões) entregue(s)`);

    return { sent: enviados };
  } catch (error) {
    logger.error(`push: falha ao enviar: ${error.message}`);
    return { sent: 0, error: error.message };
  }
}

export async function notifyVideoReady(video) {
  const hook = video?.script?.hook || "Vídeo pronto";

  return sendPush({
    title: "Vídeo pronto para aprovação",
    body: hook.length > 90 ? `${hook.slice(0, 87)}...` : hook,
    data: { tipo: "studio_pending", videoId: video?.id },
  });
}
