import crypto from "node:crypto";
import Database from "better-sqlite3";
import { logger } from "../logger.js";

const HEARTBEAT_STALE_MS = 90_000;
// Comandos destrutivos no satélite pedem autorização de volta ao cérebro
// (POST /satellite/authorize), que pode aguardar até os 120s do timeout de
// confirmationBroker — este timeout precisa ser maior que aquele com folga.
const COMMAND_TIMEOUT_MS = 130_000;

const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS satellites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    token TEXT NOT NULL,
    location TEXT,
    capabilities TEXT NOT NULL DEFAULT '[]',
    lastSeen INTEGER,
    status TEXT NOT NULL DEFAULT 'offline'
  );
`);

const upsertSatellite = db.prepare(`
  INSERT INTO satellites (id, name, host, token, location, capabilities, lastSeen, status)
  VALUES (@id, @name, @host, @token, @location, @capabilities, @lastSeen, 'online')
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    host = excluded.host,
    token = excluded.token,
    location = excluded.location,
    capabilities = excluded.capabilities,
    lastSeen = excluded.lastSeen,
    status = 'online'
`);
const selectSatellite = db.prepare("SELECT * FROM satellites WHERE id = ?");
const selectAllSatellites = db.prepare("SELECT * FROM satellites ORDER BY name ASC");
const updateHeartbeat = db.prepare("UPDATE satellites SET lastSeen = ?, status = 'online' WHERE id = ?");
const markStaleOffline = db.prepare(
  "UPDATE satellites SET status = 'offline' WHERE status = 'online' AND lastSeen < ?"
);

function rowToSatellite(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    location: row.location,
    capabilities: JSON.parse(row.capabilities || "[]"),
    lastSeen: row.lastSeen,
    status: row.status,
  };
}

export function registerSatellite(id, host, token, capabilities = [], { name, location } = {}) {
  if (!id || !host || !token) {
    throw new Error("registerSatellite: id, host e token são obrigatórios.");
  }

  upsertSatellite.run({
    id,
    name: name || id,
    host,
    token,
    location: location || null,
    capabilities: JSON.stringify(capabilities),
    lastSeen: Date.now(),
  });

  logger.info(`satelliteManager: satélite "${id}" (${name || id}) registrado em ${host}`);
  return rowToSatellite(selectSatellite.get(id));
}

export function recordHeartbeat(id, token) {
  const row = selectSatellite.get(id);

  if (!row || row.token !== token) {
    logger.warn(`satelliteManager: heartbeat rejeitado para id="${id}" (satélite desconhecido ou token inválido)`);
    return false;
  }

  updateHeartbeat.run(Date.now(), id);
  return true;
}

export function listSatellites() {
  return selectAllSatellites.all().map(rowToSatellite);
}

export function getSatellite(id) {
  return rowToSatellite(selectSatellite.get(id));
}

export function verifySatelliteToken(id, token) {
  const row = selectSatellite.get(id);
  return Boolean(row && row.token === token);
}

export async function sendToSatellite(satelliteId, tool, params) {
  const row = selectSatellite.get(satelliteId);

  if (!row) {
    throw new Error(`Satélite "${satelliteId}" não está registrado.`);
  }

  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${row.host}/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${row.token}`,
      },
      body: JSON.stringify({ satelliteId, tool, params, requestId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Satélite "${satelliteId}" respondeu HTTP ${response.status}`);
    }

    const payload = await response.json();
    logger.info(`satelliteManager: comando "${tool}" enviado a "${satelliteId}" (requestId=${requestId}, status=${payload.status})`);
    return payload;
  } catch (error) {
    logger.error(`satelliteManager: falha ao enviar comando "${tool}" para "${satelliteId}": ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startStaleSweep() {
  setInterval(() => {
    const cutoff = Date.now() - HEARTBEAT_STALE_MS;
    const result = markStaleOffline.run(cutoff);
    if (result.changes > 0) {
      logger.warn(`satelliteManager: ${result.changes} satélite(s) marcado(s) como offline (sem heartbeat há mais de ${HEARTBEAT_STALE_MS / 1000}s)`);
    }
  }, 30_000);
  logger.info("satelliteManager: sweep de satélites offline agendado (a cada 30s).");
}
