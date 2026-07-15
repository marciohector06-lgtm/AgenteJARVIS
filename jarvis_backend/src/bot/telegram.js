import "dotenv/config";
import { Telegraf } from "telegraf";
import { askAgent } from "../agent/index.js";
import { getHistory } from "../memory/index.js";
import { getProfile } from "../memory/profileManager.js";
import { logger } from "../logger.js";
import { confirmationBroker, resolveConfirmation } from "../security/confirmationBroker.js";
import { listSatellites } from "../satellite/satelliteManager.js";
import { registerNetwork, getSessionNetworkState } from "../satellite/knownNetworks.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const pendingConfirmations = new Map();

const CONFIRM_WORDS = ["confirmar", "sim", "yes"];
const CANCEL_WORDS = ["cancelar", "não", "nao", "no"];

confirmationBroker.on("request", ({ requestId, sessionId, description }) => {
  pendingConfirmations.set(String(sessionId), requestId);
  bot.telegram
    .sendMessage(
      sessionId,
      `⚠️ Comando destrutivo pendente de confirmação:\n\n${description}\n\nResponda "CONFIRMAR" ou "CANCELAR".`
    )
    .catch((error) => logger.error(`Erro ao enviar pedido de confirmação: ${error.message}`));
});

const ROLE_LABEL = {
  user: "Você",
  assistant: "J.A.R.V.I.S",
};

const ALLOWED_USER_IDS = (process.env.ALLOWED_TELEGRAM_USER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

bot.command("meuid", async (ctx) => {
  await ctx.reply(`Seu Telegram user ID: ${ctx.from.id}`);
});

bot.use(async (ctx, next) => {
  if (!ALLOWED_USER_IDS.includes(String(ctx.from?.id))) {
    logger.warn(`Acesso negado para o usuário ${ctx.from?.id}`);
    return;
  }
  return next();
});

bot.command("historico", async (ctx) => {
  try {
    const history = await getHistory(ctx.from.id);

    if (history.length === 0) {
      await ctx.reply("Ainda não há histórico de conversas com você.");
      return;
    }

    const transcript = history
      .map((turn) => `${ROLE_LABEL[turn.role] || turn.role}: ${turn.text}`)
      .join("\n\n");

    await ctx.reply(transcript.slice(-4000));
  } catch (error) {
    logger.error(`Erro ao buscar histórico: ${error.stack || error.message}`);
    await ctx.reply("Ocorreu um erro ao buscar o histórico. Tente novamente.");
  }
});

bot.command("perfil", async (ctx) => {
  try {
    const profile = getProfile();
    await ctx.reply(profile || "Ainda não há nenhum fato registrado no seu perfil.");
  } catch (error) {
    logger.error(`Erro ao buscar perfil: ${error.stack || error.message}`);
    await ctx.reply("Ocorreu um erro ao buscar o perfil. Tente novamente.");
  }
});

bot.command("satelites", async (ctx) => {
  try {
    const satellites = listSatellites();

    if (satellites.length === 0) {
      await ctx.reply("Nenhum satélite registrado ainda.");
      return;
    }

    const lines = satellites.map((sat) => {
      const emoji = sat.status === "online" ? "🟢" : "🔴";
      const lastSeen = sat.lastSeen ? new Date(sat.lastSeen).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "nunca";
      const location = sat.location ? ` — ${sat.location}` : "";
      const capabilities = sat.capabilities.length > 0 ? sat.capabilities.join(", ") : "nenhuma";
      return `${emoji} ${sat.name} (${sat.id})${location}\nHost: ${sat.host}\nCapacidades: ${capabilities}\nÚltimo sinal: ${lastSeen}`;
    });

    await ctx.reply(lines.join("\n\n"));
  } catch (error) {
    logger.error(`Erro ao listar satélites: ${error.stack || error.message}`);
    await ctx.reply("Ocorreu um erro ao listar os satélites. Tente novamente.");
  }
});

bot.command("registrar_local", async (ctx) => {
  const args = ctx.message.text.trim().split(/\s+/).slice(1);

  if (args.length < 2) {
    await ctx.reply(
      'Uso: /registrar_local <satelliteId|nenhum> <nome do local>\nVeja os IDs disponíveis em /satelites.\nEx: /registrar_local test-satellite-1 Estúdio 5K\nEx: /registrar_local nenhum Casa'
    );
    return;
  }

  const satelliteId = args[0].toLowerCase() === "nenhum" ? null : args[0];
  const name = args.slice(1).join(" ");

  const state = getSessionNetworkState("device");

  if (!state) {
    await ctx.reply(
      "O app ainda não enviou o contexto da rede atual. Abra o app conectado na rede que você quer registrar e tente de novo."
    );
    return;
  }

  try {
    registerNetwork(state.ssid, state.subnet, satelliteId, name);
    await ctx.reply(
      `Local "${name}" registrado para a rede atual do app${satelliteId ? ` (satélite: ${satelliteId})` : " (sem satélite)"}.`
    );
  } catch (error) {
    logger.error(`Erro ao registrar local: ${error.stack || error.message}`);
    await ctx.reply("Ocorreu um erro ao registrar o local. Tente novamente.");
  }
});

bot.on("text", async (ctx) => {
  const chatKey = String(ctx.from.id);
  const pendingRequestId = pendingConfirmations.get(chatKey);

  if (pendingRequestId) {
    const normalized = ctx.message.text.trim().toLowerCase();

    if (CONFIRM_WORDS.includes(normalized)) {
      pendingConfirmations.delete(chatKey);
      resolveConfirmation(pendingRequestId, true);
      await ctx.reply("Confirmado. Executando...");
      return;
    }

    if (CANCEL_WORDS.includes(normalized)) {
      pendingConfirmations.delete(chatKey);
      resolveConfirmation(pendingRequestId, false);
      await ctx.reply("Cancelado.");
      return;
    }

    await ctx.reply('Há um comando destrutivo pendente. Responda "CONFIRMAR" ou "CANCELAR".');
    return;
  }

  const userMessage = ctx.message.text;
  const thinkingMessage = await ctx.reply("Pensando...");

  try {
    const reply = await askAgent(ctx.from.id, userMessage);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      thinkingMessage.message_id,
      undefined,
      reply
    );
  } catch (error) {
    logger.error(`Erro ao processar mensagem: ${error.stack || error.message}`);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      thinkingMessage.message_id,
      undefined,
      "Ocorreu um erro ao processar sua mensagem. Tente novamente."
    );
  }
});

bot.launch();
logger.info("J.A.R.V.I.S está online.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
