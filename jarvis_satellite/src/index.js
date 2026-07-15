import "dotenv/config";
import express from "express";
import { controlSmartIoT, monitorInfra } from "../../jarvis_shared/src/index.js";
import { remoteExecute } from "../../jarvis_shared/src/remoteExec.js";
import { createRemoteGuard } from "./remoteGuard.js";

const {
  SATELLITE_ID,
  SATELLITE_NAME,
  SATELLITE_LOCATION,
  SATELLITE_TOKEN,
  SATELLITE_HOST,
  SATELLITE_PORT,
  BRAIN_URL,
  SATELLITE_REGISTRATION_SECRET,
  HEARTBEAT_INTERVAL_MS,
} = process.env;

for (const [key, value] of Object.entries({
  SATELLITE_ID,
  SATELLITE_TOKEN,
  SATELLITE_HOST,
  SATELLITE_PORT,
  BRAIN_URL,
  SATELLITE_REGISTRATION_SECRET,
})) {
  if (!value) {
    console.error(`[satellite] variável obrigatória ausente no .env: ${key}`);
    process.exit(1);
  }
}

const heartbeatIntervalMs = Number(HEARTBEAT_INTERVAL_MS) || 60_000;

const guardExecutionRemote = createRemoteGuard({
  brainUrl: BRAIN_URL,
  satelliteId: SATELLITE_ID,
  satelliteToken: SATELLITE_TOKEN,
});

// Capacidades locais deste satélite. Reaproveita a mesma lógica de execução
// que o cérebro usa (jarvis_shared) — nenhuma tool é reimplementada aqui.
// Comandos destrutivos passam por guardExecutionRemote, que pede autorização
// de volta ao cérebro (POST /satellite/authorize) antes de executar.
const capabilities = {
  echo: {
    isDestructive: () => false,
    describe: () => "echo",
    handler: async (params) => params,
  },
  smart_iot: {
    isDestructive: () => true,
    describe: (params) => `Controlar ${params.deviceType} em ${params.host}: ${params.action}`,
    handler: (params) => controlSmartIoT(params),
  },
  remote_execution: {
    isDestructive: () => true,
    describe: (params) => `Executar remotamente em ${params.host} (${params.os}, usuário "${params.username}"): ${params.command}`,
    handler: (params) => remoteExecute(params),
  },
  infra_monitor: {
    isDestructive: (params) => params.action === "wol",
    describe: (params) => (params.action === "wol" ? `Enviar Wake-on-LAN para ${params.mac}` : `infra_monitor: ${params.action}`),
    handler: (params) => monitorInfra(params),
  },
};

const app = express();
app.use(express.json());

app.post("/command", async (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;

  if (token !== SATELLITE_TOKEN) {
    return res.status(401).json({ error: "Token inválido." });
  }

  const { tool, params, requestId } = req.body || {};
  const capability = capabilities[tool];

  if (!capability) {
    return res.json({
      requestId,
      status: "error",
      result: `Ferramenta "${tool}" não suportada por este satélite.`,
      executedAt: new Date().toISOString(),
    });
  }

  const safeParams = params || {};

  try {
    const description = capability.describe(safeParams);
    const destructive = capability.isDestructive(safeParams);

    const guardResult = await guardExecutionRemote(description, { destructive }, () => capability.handler(safeParams));

    if (guardResult.blocked) {
      console.warn(`[satellite] comando "${tool}" bloqueado (requestId=${requestId})`);
      return res.json({ requestId, status: "blocked", result: guardResult.message, executedAt: new Date().toISOString() });
    }

    console.log(`[satellite] comando "${tool}" executado (requestId=${requestId})`);
    return res.json({ requestId, status: "ok", result: guardResult.result, executedAt: new Date().toISOString() });
  } catch (error) {
    console.error(`[satellite] erro ao executar "${tool}": ${error.message}`);
    return res.json({ requestId, status: "error", result: error.message, executedAt: new Date().toISOString() });
  }
});

async function registerWithBrain() {
  try {
    const response = await fetch(`${BRAIN_URL}/satellite/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: SATELLITE_ID,
        name: SATELLITE_NAME || SATELLITE_ID,
        host: SATELLITE_HOST,
        token: SATELLITE_TOKEN,
        location: SATELLITE_LOCATION || null,
        capabilities: Object.keys(capabilities),
        secret: SATELLITE_REGISTRATION_SECRET,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    console.log(`[satellite] registrado com sucesso no cérebro (${BRAIN_URL}).`);
    return true;
  } catch (error) {
    console.error(`[satellite] falha ao registrar no cérebro: ${error.message}`);
    return false;
  }
}

async function sendHeartbeat() {
  try {
    const response = await fetch(`${BRAIN_URL}/satellite/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: SATELLITE_ID, token: SATELLITE_TOKEN }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    console.error(`[satellite] falha no heartbeat: ${error.message}`);
  }
}

app.listen(Number(SATELLITE_PORT), async () => {
  console.log(`[satellite] "${SATELLITE_ID}" ouvindo na porta ${SATELLITE_PORT}.`);

  const registered = await registerWithBrain();
  if (!registered) {
    console.warn("[satellite] tentando novamente em 10s...");
    const retryId = setInterval(async () => {
      if (await registerWithBrain()) {
        clearInterval(retryId);
      }
    }, 10_000);
  }

  setInterval(sendHeartbeat, heartbeatIntervalMs);
});
