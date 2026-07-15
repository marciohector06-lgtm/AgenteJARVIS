import Database from "better-sqlite3";
import { logger } from "../logger.js";

const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS known_networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ssid TEXT,
    subnet TEXT,
    satelliteId TEXT,
    location TEXT NOT NULL,
    registeredAt INTEGER NOT NULL
  );
`);

const insertNetwork = db.prepare(`
  INSERT INTO known_networks (ssid, subnet, satelliteId, location, registeredAt)
  VALUES (?, ?, ?, ?, ?)
`);
const selectBySsid = db.prepare("SELECT * FROM known_networks WHERE ssid = ? ORDER BY id DESC LIMIT 1");
const selectBySubnet = db.prepare("SELECT * FROM known_networks WHERE subnet = ? ORDER BY id DESC LIMIT 1");
const selectByLocation = db.prepare(
  "SELECT * FROM known_networks WHERE location = ? COLLATE NOCASE ORDER BY id DESC LIMIT 1"
);
const selectAll = db.prepare("SELECT * FROM known_networks ORDER BY location ASC");

// Estado da última rede reportada por sessão — só em memória (mesmo padrão do
// kill switch e do socketsBySession de server.js). Reinicia com o processo;
// o app reenvia o contexto de rede a cada connect, então isso é aceitável.
const sessionNetworkState = new Map();

function rowToNetwork(row) {
  if (!row) return null;
  return {
    ssid: row.ssid,
    subnet: row.subnet,
    satelliteId: row.satelliteId,
    location: row.location,
  };
}

export function registerNetwork(ssid, subnet, satelliteId, location) {
  if (!location) {
    throw new Error("registerNetwork: location é obrigatório.");
  }
  if (!ssid && !subnet) {
    throw new Error("registerNetwork: ssid ou subnet é obrigatório.");
  }

  insertNetwork.run(ssid || null, subnet || null, satelliteId || null, location, Date.now());
  logger.info(`knownNetworks: rede registrada como "${location}" (ssid=${ssid || "-"}, subnet=${subnet || "-"}, satelliteId=${satelliteId || "nenhum"})`);
  return findNetworkBySsidOrSubnet(ssid, subnet);
}

export function findNetworkBySsidOrSubnet(ssid, subnet) {
  if (ssid) {
    const bySsid = rowToNetwork(selectBySsid.get(ssid));
    if (bySsid) return bySsid;
  }
  if (subnet) {
    const bySubnet = rowToNetwork(selectBySubnet.get(subnet));
    if (bySubnet) return bySubnet;
  }
  return null;
}

export function findNetworkByLocation(name) {
  return rowToNetwork(selectByLocation.get(name));
}

export function listKnownNetworks() {
  return selectAll.all().map(rowToNetwork);
}

export function recordNetworkContext(sessionId, ssid, subnet) {
  const match = findNetworkBySsidOrSubnet(ssid, subnet);

  const state = {
    ssid: ssid || null,
    subnet: subnet || null,
    location: match?.location || null,
    satelliteId: match?.satelliteId || null,
    matched: Boolean(match),
    updatedAt: Date.now(),
  };

  sessionNetworkState.set(sessionId, state);
  return state;
}

export function getSessionNetworkState(sessionId) {
  return sessionNetworkState.get(sessionId) || null;
}
