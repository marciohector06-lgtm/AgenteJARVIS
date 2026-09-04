import { client, isWhatsAppReady } from "../bot/whatsapp.js";
import { logger } from "../logger.js";

// Ao contrário do Telegram (API HTTP stateless, dava pra criar uma instância
// leve só de envio), o WhatsApp Web não tem "cliente sem sessão" — o client
// importado de bot/whatsapp.js É a sessão autenticada inteira. Por isso este
// notifier reusa o singleton em vez de abrir uma segunda conexão.

function normalizeNumber(raw) {
  return String(raw || "").replace(/\D/g, "");
}

function toJid(number) {
  return `${normalizeNumber(number)}@c.us`;
}

const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => normalizeNumber(n))
  .filter(Boolean);

const OWNER_NUMBER = normalizeNumber(process.env.WHATSAPP_OWNER_NUMBER);

async function sendToNumber(number, text) {
  try {
    await client.sendMessage(toJid(number), text);
    return true;
  } catch (error) {
    logger.error(`proactive: falha ao enviar notificação WhatsApp pra ${number}: ${error.message}`);
    return false;
  }
}

export async function notifyWhatsApp(text) {
  if (!isWhatsAppReady()) {
    logger.warn("proactive: cliente WhatsApp ainda não está pronto, notificação não enviada");
    return false;
  }

  if (ALLOWED_NUMBERS.length === 0) {
    logger.warn("proactive: ALLOWED_WHATSAPP_NUMBERS vazio, nenhuma notificação enviada");
    return false;
  }

  const results = await Promise.all(ALLOWED_NUMBERS.map((number) => sendToNumber(number, text)));
  return results.some(Boolean);
}

export function getPrimaryUserId() {
  // Mesmo formato de sessionId usado em bot/whatsapp.js (message.from é a JID
  // completa, ex: "5561999999999@c.us") — precisa bater pra weekly.js
  // encontrar o histórico certo em getHistorySince(userId, ...).
  return OWNER_NUMBER ? toJid(OWNER_NUMBER) : null;
}
