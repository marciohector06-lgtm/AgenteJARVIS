import "dotenv/config";
import express from "express";

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

// Registro de capacidades locais deste satélite. Cada satélite anuncia só as
// ferramentas que ele de fato consegue executar (echo aqui é a prova de vida
// mínima usada no teste do protocolo cérebro-satélite).
const capabilities = {
  echo: async (params) => params,
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
  const executedAt = new Date().toISOString();

  const handler = capabilities[tool];
  if (!handler) {
    return res.json({ requestId, status: "error", result: `Ferramenta "${tool}" não suportada por este satélite.`, executedAt });
  }

  try {
    const result = await handler(params || {});
    console.log(`[satellite] comando "${tool}" executado (requestId=${requestId})`);
    return res.json({ requestId, status: "ok", result, executedAt });
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
