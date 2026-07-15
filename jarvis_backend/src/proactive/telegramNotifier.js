import { Telegraf } from "telegraf";
import { logger } from "../logger.js";

// Instância separada só pra enviar mensagens (nunca chama .launch(), então não
// entra em conflito com o polling do bot principal em src/bot/telegram.js —
// dois processos fazendo long polling com o mesmo token gerariam erro 409).
const telegram = new Telegraf(process.env.TELEGRAM_BOT_TOKEN).telegram;

const ALLOWED_USER_IDS = (process.env.ALLOWED_TELEGRAM_USER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

async function sendToUser(userId, text) {
  try {
    await telegram.sendMessage(userId, text, { parse_mode: "Markdown" });
    return true;
  } catch (error) {
    // Texto gerado por LLM não tem garantia nenhuma de ser Markdown válido pro
    // parser (bem rígido) do Telegram — um "*" ou "_" desbalanceado quebra a
    // mensagem inteira. Não dá pra confiar em parse_mode aqui: tenta nele,
    // mas cai pra texto plano se falhar, em vez de simplesmente perder o alerta.
    logger.warn(`proactive: envio com Markdown falhou pra ${userId} (${error.message}), tentando texto plano...`);
    try {
      await telegram.sendMessage(userId, text);
      return true;
    } catch (plainError) {
      logger.error(`proactive: falha ao enviar notificação pra ${userId}: ${plainError.message}`);
      return false;
    }
  }
}

export async function notifyTelegram(text) {
  if (ALLOWED_USER_IDS.length === 0) {
    logger.warn("proactive: ALLOWED_TELEGRAM_USER_IDS vazio, nenhuma notificação enviada");
    return false;
  }

  const results = await Promise.all(ALLOWED_USER_IDS.map((userId) => sendToUser(userId, text)));
  return results.some(Boolean);
}

export function getPrimaryUserId() {
  return ALLOWED_USER_IDS[0] || null;
}
