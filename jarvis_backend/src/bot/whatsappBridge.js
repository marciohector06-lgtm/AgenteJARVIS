import { timingSafeEqual } from "node:crypto";
import express from "express";
import { logger } from "../logger.js";
import { isAllowedWhatsappNumber, normalizeWhatsappNumber, toWhatsappJid } from "./whatsappAllowlist.js";

const MAX_MESSAGE_LENGTH = 4000;
const DEFAULT_BRIDGE_PORT = 4010;

function tokensMatch(received, expected) {
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(String(expected || ""));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function startWhatsappBridge({ client, isReady }) {
  const expectedToken = process.env.WHATSAPP_BRIDGE_TOKEN;
  const port = Number(process.env.WHATSAPP_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);

  if (!expectedToken) {
    logger.warn(
      "whatsappBridge: WHATSAPP_BRIDGE_TOKEN ausente — a ponte HTTP do WhatsApp NÃO subiu. O envio via MCP ficará indisponível."
    );
    return null;
  }

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.use((req, res, next) => {
    if (!tokensMatch(req.headers["x-bridge-token"], expectedToken)) {
      return res.status(401).json({ error: "Token de ponte inválido." });
    }
    return next();
  });

  app.get("/internal/whatsapp/status", (req, res) => {
    const ready = Boolean(isReady());
    return res.json({ ready, me: ready && client.info ? client.info.wid?.user ?? null : null });
  });

  app.post("/internal/whatsapp/send", async (req, res) => {
    const { to, message } = req.body || {};

    if (!to || !message) {
      return res.status(400).json({ error: "to e message são obrigatórios." });
    }

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message deve ser um texto não vazio." });
    }

    const number = normalizeWhatsappNumber(to);

    if (!number) {
      return res.status(400).json({ error: "to deve conter um número de telefone com DDI e DDD, só dígitos." });
    }

    if (!isAllowedWhatsappNumber(number)) {
      logger.warn(`whatsappBridge: envio NEGADO para número fora da allowlist: ${number}`);
      return res.status(403).json({
        error: "Número fora da allowlist (ALLOWED_WHATSAPP_NUMBERS / WHATSAPP_OWNER_NUMBER). Envio recusado.",
      });
    }

    if (!isReady()) {
      return res.status(503).json({ error: "Sessão do WhatsApp ainda não está pronta. Tente novamente em instantes." });
    }

    const body = message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) : message;

    try {
      await client.sendMessage(toWhatsappJid(number), body);
      logger.info(`whatsappBridge: mensagem enviada para ${number} (${body.length} chars).`);
      return res.json({ sent: true, to: number, length: body.length, truncated: body.length < message.length });
    } catch (error) {
      logger.error(`whatsappBridge: erro ao enviar mensagem: ${error.stack || error.message}`);
      return res.status(502).json({ error: "Falha ao enviar a mensagem pelo WhatsApp." });
    }
  });

  const server = app.listen(port, "127.0.0.1", () => {
    logger.info(`whatsappBridge: ponte HTTP ouvindo em 127.0.0.1:${port} (somente loopback).`);
  });

  server.on("error", (error) => {
    logger.error(`whatsappBridge: falha ao subir a ponte na porta ${port}: ${error.message}`);
  });

  return server;
}
