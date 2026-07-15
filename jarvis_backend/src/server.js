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
import { confirmationBroker, requestConfirmation, resolveConfirmation } from "./security/confirmationBroker.js";
import { getProfile, updateProfile } from "./memory/profileManager.js";
import { startBriefing } from "./proactive/briefing.js";
import { startMonitor } from "./proactive/monitor.js";
import { startFollowup } from "./proactive/followup.js";
import { startWeekly } from "./proactive/weekly.js";
import { analyzeMedia } from "./media/mediaAnalyzer.js";
import { buildDashboard } from "./dashboard/index.js";
import { isKillSwitchActive, setKillSwitch } from "./security/killSwitch.js";
import {
  registerSatellite,
  recordHeartbeat,
  listSatellites,
  verifySatelliteToken,
  startStaleSweep,
} from "./satellite/satelliteManager.js";

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

app.post("/satellite/register", (req, res) => {
  const { id, name, host, token, location, capabilities, secret } = req.body || {};

  if (!process.env.SATELLITE_REGISTRATION_SECRET || secret !== process.env.SATELLITE_REGISTRATION_SECRET) {
    return res.status(401).json({ error: "Segredo de registro inválido." });
  }

  if (!id || !host || !token) {
    return res.status(400).json({ error: "id, host e token são obrigatórios." });
  }

  try {
    const satellite = registerSatellite(id, host, token, capabilities || [], { name, location });
    return res.json({ satellite });
  } catch (error) {
    logger.error(`Erro ao registrar satélite: ${error.stack || error.message}`);
    return res.status(500).json({ error: "Erro ao registrar satélite." });
  }
});

app.post("/satellite/heartbeat", (req, res) => {
  const { id, token } = req.body || {};

  if (!id || !token) {
    return res.status(400).json({ error: "id e token são obrigatórios." });
  }

  const ok = recordHeartbeat(id, token);
  if (!ok) {
    return res.status(401).json({ error: "Satélite desconhecido ou token inválido." });
  }

  return res.json({ ok: true });
});

// Chamado pelo satélite antes de executar uma capacidade destrutiva
// localmente — o próprio satélite não tem UI de confirmação, então a decisão
// (kill switch / REQUIRE_CONFIRM / prompt no app) acontece aqui, no cérebro,
// reaproveitando o mesmo confirmationBroker que guardExecution usa.
app.post("/satellite/authorize", async (req, res) => {
  const { id, token, description } = req.body || {};

  if (!id || !token || !description) {
    return res.status(400).json({ error: "id, token e description são obrigatórios." });
  }

  if (!verifySatelliteToken(id, token)) {
    return res.status(401).json({ error: "Satélite desconhecido ou token inválido." });
  }

  if (isKillSwitchActive()) {
    logger.warn(`satellite authorize: BLOQUEADO pelo kill switch: "${description}" (satelliteId=${id})`);
    return res.json({ approved: false, reason: "kill_switch" });
  }

  if (process.env.REQUIRE_CONFIRM !== "true") {
    return res.json({ approved: true });
  }

  logger.warn(`satellite authorize: comando destrutivo aguardando confirmação: "${description}" (satelliteId=${id})`);
  const approved = await requestConfirmation("device", description);
  logger.info(
    `satellite authorize: comando "${description}" ${approved ? "CONFIRMADO" : "NEGADO/expirado"} (satelliteId=${id})`
  );
  return res.json({ approved });
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

  socket.emit("jarvis:kill_switch", { active: isKillSwitchActive() });

  socket.on("user:confirm", ({ requestId, approved } = {}) => {
    if (!requestId) return;
    resolveConfirmation(requestId, Boolean(approved));
  });

  socket.on("user:message", async ({ text } = {}) => {
    if (!text) return;

    try {
      const reply = await askAgent(socket.sessionId, text, {
        onPlan: (steps) => socket.emit("jarvis:plan", { steps }),
        onStepDone: (stepResult) => socket.emit("jarvis:step_done", stepResult),
        onChunk: (chunkText) => socket.emit("jarvis:stream_chunk", { text: chunkText }),
      });
      socket.emit("jarvis:stream_end");
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
      const reply = await askAgent(socket.sessionId, text, {
        onPlan: (steps) => socket.emit("jarvis:plan", { steps }),
        onStepDone: (stepResult) => socket.emit("jarvis:step_done", stepResult),
        onChunk: (chunkText) => socket.emit("jarvis:stream_chunk", { text: chunkText }),
      });
      socket.emit("jarvis:stream_end");
      await respondWithVoice(socket, reply);
      logger.info(`user:audio processado com sucesso (sessionId: ${socket.sessionId})`);
    } catch (error) {
      logger.error(`Erro ao processar áudio: ${error.stack || error.message}`);
      socket.emit("jarvis:error", { message: "Ocorreu um erro ao processar seu áudio." });
    }
  });

  socket.on("user:media", async ({ mediaBuffer, mimeType, caption } = {}) => {
    if (!mediaBuffer || !mimeType) return;

    try {
      const analysis = await analyzeMedia(mediaBuffer, mimeType, caption);
      await respondWithVoice(socket, analysis);
      logger.info(`user:media processado com sucesso (sessionId: ${socket.sessionId}, mimeType: ${mimeType})`);
    } catch (error) {
      logger.error(`Erro ao processar mídia: ${error.stack || error.message}`);
      socket.emit("jarvis:error", { message: "Ocorreu um erro ao processar sua mídia." });
    }
  });

  socket.on("user:kill_switch", ({ active } = {}) => {
    const newState = setKillSwitch(active);
    io.emit("jarvis:kill_switch", { active: newState });
  });

  socket.on("user:list_satellites", () => {
    socket.emit("jarvis:satellites", { satellites: listSatellites() });
  });

  socket.on("user:get_dashboard", async () => {
    try {
      const dashboard = await buildDashboard(socketsBySession.size);
      socket.emit("jarvis:dashboard", dashboard);
    } catch (error) {
      logger.error(`Erro ao montar dashboard: ${error.stack || error.message}`);
      socket.emit("jarvis:error", { message: "Ocorreu um erro ao montar o dashboard." });
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
  startBriefing();
  startMonitor();
  startFollowup();
  startWeekly();
  startStaleSweep();
});
