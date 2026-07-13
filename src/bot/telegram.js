import "dotenv/config";
import { Telegraf } from "telegraf";
import { askAgent } from "../agent/index.js";
import { getHistory } from "../memory/index.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

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
    console.warn(`Acesso negado para o usuário ${ctx.from?.id}`);
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
    console.error("Erro ao buscar histórico:", error);
    await ctx.reply("Ocorreu um erro ao buscar o histórico. Tente novamente.");
  }
});

bot.on("text", async (ctx) => {
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
    console.error("Erro ao processar mensagem:", error);
    await ctx.telegram.editMessageText(
      ctx.chat.id,
      thinkingMessage.message_id,
      undefined,
      "Ocorreu um erro ao processar sua mensagem. Tente novamente."
    );
  }
});

bot.launch();
console.log("J.A.R.V.I.S está online.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
