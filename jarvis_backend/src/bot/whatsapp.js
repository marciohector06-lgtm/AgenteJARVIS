import "dotenv/config";
import pkg from "whatsapp-web.js";
import qrcodeTerminal from "qrcode-terminal";
import { askAgent } from "../agent/index.js";
import { getHistory } from "../memory/index.js";
import { getProfile } from "../memory/profileManager.js";
import { logger } from "../logger.js";
import { confirmationBroker, resolveConfirmation } from "../security/confirmationBroker.js";
import { listSatellites } from "../satellite/satelliteManager.js";
import { registerNetwork, getSessionNetworkState } from "../satellite/knownNetworks.js";
import { startBriefing } from "../proactive/briefing.js";
import { startMonitor } from "../proactive/monitor.js";
import { startFollowup } from "../proactive/followup.js";
import { startWeekly } from "../proactive/weekly.js";
import { startWhatsappBridge } from "./whatsappBridge.js";

const { Client, LocalAuth } = pkg;

function normalizeNumber(raw) {
  return String(raw || "").replace(/\D/g, "");
}

const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || "")
  .split(",")
  .map((n) => normalizeNumber(n))
  .filter(Boolean);

const OWNER_NUMBER = normalizeNumber(process.env.WHATSAPP_OWNER_NUMBER);

function isAllowed(number) {
  return ALLOWED_NUMBERS.includes(number) || (Boolean(OWNER_NUMBER) && number === OWNER_NUMBER);
}

// LocalAuth persiste a sessão em jarvis_backend/.wwebjs_auth/ — o QR code só
// precisa ser escaneado uma vez; nas próximas vezes o cliente reconecta
// sozinho a partir dessa pasta (gitignored, é segredo de sessão).
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "jarvis" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// client.info só fica populado (ClientInfo com wid/pushname/plataforma) depois
// que o evento "ready" dispara — mas não temos garantia de que a lib limpa
// esse campo num disconnect/reconexão. Por segurança mantemos nossa própria
// flag, ligada/desligada explicitamente pelos eventos que já observamos.
let isReady = false;

// Garante que os crons proativos só sejam agendados UMA vez por processo,
// mesmo que "ready" dispare de novo depois de uma reconexão (node-cron não
// tem proteção própria contra agendamento duplicado).
let proactiveStarted = false;

const pendingConfirmations = new Map();

const CONFIRM_WORDS = ["confirmar", "sim", "yes"];
const CANCEL_WORDS = ["cancelar", "não", "nao", "no"];

confirmationBroker.on("request", ({ requestId, sessionId, description }) => {
  pendingConfirmations.set(String(sessionId), requestId);
  client
    .sendMessage(
      sessionId,
      `⚠️ Comando destrutivo pendente de confirmação:\n\n${description}\n\nResponda "CONFIRMAR" ou "CANCELAR".`
    )
    .catch((error) => logger.error(`whatsapp: erro ao enviar pedido de confirmação: ${error.message}`));
});

const ROLE_LABEL = {
  user: "Você",
  assistant: "J.A.R.V.I.S",
};

async function replyTruncated(message, text) {
  // Mesmo corte de segurança usado no canal Telegram, por precaução com
  // mensagens muito longas.
  await message.reply(text.length > 4000 ? text.slice(-4000) : text);
}

client.on("qr", (qr) => {
  logger.info(
    "whatsapp: escaneie o QR code abaixo com o WhatsApp do número autorizado (só é necessário na primeira vez — a sessão fica salva em jarvis_backend/.wwebjs_auth/)."
  );
  qrcodeTerminal.generate(qr, { small: true });
});

client.on("authenticated", () => {
  logger.info("whatsapp: autenticado com sucesso.");
});

client.on("auth_failure", (message) => {
  isReady = false;
  logger.error(`whatsapp: falha de autenticação: ${message}`);
});

client.on("disconnected", (reason) => {
  isReady = false;
  logger.warn(`whatsapp: cliente desconectado (${reason}).`);
});

client.on("ready", () => {
  isReady = true;
  logger.info("J.A.R.V.I.S (WhatsApp) está online.");

  // Os crons proativos (briefing/monitor/followup/weekly) precisam rodar
  // neste MESMO processo, porque suas notificações dependem do client
  // singleton do WhatsApp declarado aqui — não existe "client leve, só de
  // envio" como havia no Telegram, já que a sessão inteira do WhatsApp Web
  // é o próprio client.
  if (!proactiveStarted) {
    proactiveStarted = true;
    startBriefing();
    startMonitor();
    startFollowup();
    startWeekly();
  }
});

client.on("message", async (message) => {
  // Guarda contra mensagens chegando fora da janela em que o cliente está
  // realmente pronto (ex.: durante uma reconexão) — melhor ignorar em
  // silêncio do que tentar processar com o client num estado inconsistente.
  if (!isReady || !client.info) {
    logger.warn(`whatsapp: mensagem recebida com o cliente ainda não pronto (from=${message.from}), ignorando.`);
    return;
  }

  // Ignora grupos e broadcasts de status — o bot é pessoal, um-pra-um.
  if (message.from.endsWith("@g.us") || message.from === "status@broadcast") return;

  const senderNumber = normalizeNumber(message.from.split("@")[0]);

  if (!isAllowed(senderNumber)) {
    logger.warn(`whatsapp: acesso negado para o número ${senderNumber}`);
    return;
  }

  const sessionId = message.from;
  const text = (message.body || "").trim();

  if (!text) return;

  const pendingRequestId = pendingConfirmations.get(sessionId);

  if (pendingRequestId) {
    const normalized = text.toLowerCase();

    if (CONFIRM_WORDS.includes(normalized)) {
      pendingConfirmations.delete(sessionId);
      resolveConfirmation(pendingRequestId, true);
      await message.reply("Confirmado. Executando...");
      return;
    }

    if (CANCEL_WORDS.includes(normalized)) {
      pendingConfirmations.delete(sessionId);
      resolveConfirmation(pendingRequestId, false);
      await message.reply("Cancelado.");
      return;
    }

    await message.reply('Há um comando destrutivo pendente. Responda "CONFIRMAR" ou "CANCELAR".');
    return;
  }

  if (text === "/historico") {
    try {
      const history = await getHistory(sessionId);

      if (history.length === 0) {
        await message.reply("Ainda não há histórico de conversas com você.");
        return;
      }

      const transcript = history
        .map((turn) => `${ROLE_LABEL[turn.role] || turn.role}: ${turn.text}`)
        .join("\n\n");

      await replyTruncated(message, transcript);
    } catch (error) {
      logger.error(`whatsapp: erro ao buscar histórico: ${error.stack || error.message}`);
      await message.reply("Ocorreu um erro ao buscar o histórico. Tente novamente.");
    }
    return;
  }

  if (text === "/perfil") {
    try {
      const profile = getProfile();
      await message.reply(profile || "Ainda não há nenhum fato registrado no seu perfil.");
    } catch (error) {
      logger.error(`whatsapp: erro ao buscar perfil: ${error.stack || error.message}`);
      await message.reply("Ocorreu um erro ao buscar o perfil. Tente novamente.");
    }
    return;
  }

  if (text === "/satelites") {
    try {
      const satellites = listSatellites();

      if (satellites.length === 0) {
        await message.reply("Nenhum satélite registrado ainda.");
        return;
      }

      const lines = satellites.map((sat) => {
        const emoji = sat.status === "online" ? "🟢" : "🔴";
        const lastSeen = sat.lastSeen
          ? new Date(sat.lastSeen).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
          : "nunca";
        const location = sat.location ? ` — ${sat.location}` : "";
        const capabilities = sat.capabilities.length > 0 ? sat.capabilities.join(", ") : "nenhuma";
        return `${emoji} ${sat.name} (${sat.id})${location}\nHost: ${sat.host}\nCapacidades: ${capabilities}\nÚltimo sinal: ${lastSeen}`;
      });

      await message.reply(lines.join("\n\n"));
    } catch (error) {
      logger.error(`whatsapp: erro ao listar satélites: ${error.stack || error.message}`);
      await message.reply("Ocorreu um erro ao listar os satélites. Tente novamente.");
    }
    return;
  }

  if (text.startsWith("/registrar_local")) {
    const args = text.trim().split(/\s+/).slice(1);

    if (args.length < 2) {
      await message.reply(
        'Uso: /registrar_local <satelliteId|nenhum> <nome do local>\nVeja os IDs disponíveis em /satelites.\nEx: /registrar_local test-satellite-1 Estúdio 5K\nEx: /registrar_local nenhum Casa'
      );
      return;
    }

    const satelliteId = args[0].toLowerCase() === "nenhum" ? null : args[0];
    const name = args.slice(1).join(" ");

    const state = getSessionNetworkState("device");

    if (!state) {
      await message.reply(
        "O app ainda não enviou o contexto da rede atual. Abra o app conectado na rede que você quer registrar e tente de novo."
      );
      return;
    }

    try {
      registerNetwork(state.ssid, state.subnet, satelliteId, name);
      await message.reply(
        `Local "${name}" registrado para a rede atual do app${satelliteId ? ` (satélite: ${satelliteId})` : " (sem satélite)"}.`
      );
    } catch (error) {
      logger.error(`whatsapp: erro ao registrar local: ${error.stack || error.message}`);
      await message.reply("Ocorreu um erro ao registrar o local. Tente novamente.");
    }
    return;
  }

  try {
    const reply = await askAgent(sessionId, text);
    await replyTruncated(message, reply);
  } catch (error) {
    logger.error(`whatsapp: erro ao processar mensagem: ${error.stack || error.message}`);
    await message.reply("Ocorreu um erro ao processar sua mensagem. Tente novamente.");
  }
});

client.initialize();

// Exportados pra whatsappNotifier.js reusar o MESMO client (singleton) em vez
// de abrir uma segunda sessão WhatsApp Web — client.info só existe depois do
// "ready" (mesmo raciocínio do guard em client.on("message", ...) acima).
export { client };
export function isWhatsAppReady() {
  return isReady && Boolean(client.info);
}

startWhatsappBridge({ client, isReady: isWhatsAppReady });

process.once("SIGINT", async () => {
  await client.destroy().catch(() => {});
  process.exit(0);
});
process.once("SIGTERM", async () => {
  await client.destroy().catch(() => {});
  process.exit(0);
});
