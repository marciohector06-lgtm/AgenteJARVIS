import "dotenv/config";
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { askAgent } from "./agent/index.js";
import { transcribeAudio } from "./audio/stt.js";
import { textToSpeech } from "./audio/tts.js";
import { logger } from "./logger.js";
import { startKnowledgeScraper } from "./scraper/knowledgeScraper.js";
import { startDisasterRecoveryCron } from "./tools/disasterRecoveryTool.js";
import { confirmationBroker, resolveConfirmation } from "./security/confirmationBroker.js";
import { getProfile, updateProfile } from "./memory/profileManager.js";

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const DEVICE_PIN = process.env.DEVICE_PIN;

const app = express();
app.use(express.json());

app.post("/auth/token", (req, res) => {
  const { devicePin } = req.body || {};

  if (!DEVICE_PIN || devicePin !== DEVICE_PIN) {
    return res.status(401).json({ error: "PIN inválido." });
  }

  const token = jwt.sign({ sub: "device" }, JWT_SECRET, { expiresIn: "24h" });
  return res.json({ token });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

io.use((socket, next) => {
  const { token } = socket.handshake.auth || {};

  if (!token) {
    return next(new Error("Token ausente."));
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.sessionId = payload.sub;
    return next();
  } catch {
    return next(new Error("Token inválido ou expirado."));
  }
});

async function respondWithVoice(socket, replyText) {
  const audioBuffer = await textToSpeech(replyText);
  socket.emit("jarvis:response", { text: replyText, audioBuffer: audioBuffer.toString("base64") });
}

const socketsBySession = new Map();

confirmationBroker.on("request", ({ requestId, sessionId, description }) => {
  const sessionSockets = socketsBySession.get(sessionId);

  if (!sessionSockets || sessionSockets.size === 0) {
    logger.warn(
      `guardExecution: nenhum socket conectado para sessionId=${sessionId}; negando confirmação de "${description}"`
    );
    resolveConfirmation(requestId, false);
    return;
  }

  for (const socket of sessionSockets) {
    socket.emit("jarvis:confirm_needed", { requestId, command: description });
  }
});

io.on("connection", (socket) => {
  logger.info(`Cliente conectado (sessionId: ${socket.sessionId})`);

  const sessionSockets = socketsBySession.get(socket.sessionId) || new Set();
  sessionSockets.add(socket);
  socketsBySession.set(socket.sessionId, sessionSockets);

  socket.on("user:confirm", ({ requestId, approved } = {}) => {
    if (!requestId) return;
    resolveConfirmation(requestId, Boolean(approved));
  });

  socket.on("user:message", async ({ text } = {}) => {
    if (!text) return;

    try {
      const reply = await askAgent(socket.sessionId, text);
      await respondWithVoice(socket, reply);
      logger.info(`user:message processada com sucesso (sessionId: ${socket.sessionId})`);
    } catch (error) {
      logger.error(`Erro ao processar mensagem: ${error.stack || error.message}`);
      socket.emit("jarvis:error", { message: "Ocorreu um erro ao processar sua mensagem." });
    }
  });

  socket.on("user:audio", async ({ audioBuffer, mimeType } = {}) => {
    if (!audioBuffer) return;

    try {
      const buffer = Buffer.from(audioBuffer, "base64");
      const text = await transcribeAudio(buffer, mimeType);
      const reply = await askAgent(socket.sessionId, text);
      await respondWithVoice(socket, reply);
      logger.info(`user:audio processado com sucesso (sessionId: ${socket.sessionId})`);
    } catch (error) {
      logger.error(`Erro ao processar áudio: ${error.stack || error.message}`);
      socket.emit("jarvis:error", { message: "Ocorreu um erro ao processar seu áudio." });
    }
  });

  socket.on("user:get_profile", () => {
    socket.emit("jarvis:profile", { profile: getProfile() });
  });

  socket.on("user:update_profile", ({ category, key, value, confidence } = {}) => {
    if (!category || !key || !value) {
      socket.emit("jarvis:error", { message: "category, key e value são obrigatórios para user:update_profile." });
      return;
    }

    updateProfile(category, key, value, confidence);
    socket.emit("jarvis:profile", { profile: getProfile() });
  });

  socket.on("disconnect", () => {
    sessionSockets.delete(socket);
    logger.info(`Cliente desconectado (sessionId: ${socket.sessionId})`);
  });
});

httpServer.listen(PORT, () => {
  logger.info(`J.A.R.V.I.S server (Express + Socket.io) rodando na porta ${PORT}.`);
  startKnowledgeScraper();
  startDisasterRecoveryCron();
});
