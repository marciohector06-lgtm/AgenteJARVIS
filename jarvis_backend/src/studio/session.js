import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { STUDIO_ROOT_DIR, ensureStudioDirs } from "./paths.js";

const SESSION_FILE = join(STUDIO_ROOT_DIR, "tiktok-mining-session.json");

function belongsToTikTok(cookie) {
  return String(cookie.domain || "").toLowerCase().includes("tiktok.com");
}

async function allTikTokCookies(page) {
  const client = await page.createCDPSession();

  try {
    const { cookies } = await client.send("Network.getAllCookies");
    return cookies.filter(belongsToTikTok);
  } finally {
    await client.detach().catch(() => {});
  }
}

export function sessionPath() {
  return SESSION_FILE;
}

export function hasSession() {
  return existsSync(SESSION_FILE);
}

export function readSession() {
  if (!hasSession()) return null;

  try {
    const parsed = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return Array.isArray(parsed.cookies) ? parsed : null;
  } catch {
    logger.warn("studio session: arquivo de sessão ilegível — trate como ausente");
    return null;
  }
}

export function sessionStatus() {
  const session = readSession();
  if (!session) return { present: false };

  const now = Date.now() / 1000;
  const expiring = session.cookies.filter((cookie) => cookie.expires > 0 && cookie.expires < now);

  return {
    present: true,
    account: session.account || "desconhecida",
    savedAt: session.savedAt,
    cookieCount: session.cookies.length,
    expiredCookies: expiring.length,
    authenticated: session.cookies.some((cookie) => cookie.name === "sessionid"),
    domains: [...new Set(session.cookies.map((cookie) => cookie.domain))].sort(),
  };
}

export async function saveSession(page, account) {
  ensureStudioDirs();

  const cookies = await allTikTokCookies(page);

  if (cookies.length === 0) {
    throw new Error("Nenhum cookie do TikTok encontrado — o login não foi concluído.");
  }

  if (!cookies.some((cookie) => cookie.name === "sessionid")) {
    throw new Error(
      "Cookies capturados, mas sem 'sessionid' — a sessão não está autenticada de verdade e os painéis cairiam no login.",
    );
  }

  writeFileSync(
    SESSION_FILE,
    JSON.stringify({ account, savedAt: new Date().toISOString(), cookies }, null, 2),
    { mode: 0o600 },
  );

  logger.info(`studio session: ${cookies.length} cookies salvos para ${account}`);

  return { path: SESSION_FILE, cookieCount: cookies.length };
}

export async function applySession(page) {
  const session = readSession();
  if (!session) return false;

  const client = await page.createCDPSession();

  try {
    await client.send("Network.setCookies", { cookies: session.cookies });
  } finally {
    await client.detach().catch(() => {});
  }

  logger.info(`studio session: sessão de ${session.account || "conta de mineração"} aplicada (${session.cookies.length} cookies)`);

  return true;
}

export function clearSession() {
  if (!hasSession()) return false;
  rmSync(SESSION_FILE, { force: true });
  logger.info("studio session: sessão de mineração removida");
  return true;
}
