import cron from "node-cron";
import { infraMonitorTool } from "../tools/infraMonitorTool.js";
import { logger } from "../logger.js";
import { notifyTelegram } from "./telegramNotifier.js";

const CRON_SCHEDULE = "*/5 * * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const lastAlertAt = new Map();

async function alertOnce(key, message) {
  const now = Date.now();
  const last = lastAlertAt.get(key);

  if (last && now - last < ALERT_COOLDOWN_MS) {
    return;
  }

  lastAlertAt.set(key, now);
  const sent = await notifyTelegram(message);
  if (!sent) {
    logger.error(`monitor: alerta "${key}" NÃO foi entregue no Telegram`);
  }
}

function parseMonitorHosts() {
  return (process.env.MONITOR_HOSTS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, host] = entry.includes(":") ? entry.split(":").map((s) => s.trim()) : [entry, entry];
      return { name, host };
    });
}

async function checkHosts() {
  const hosts = parseMonitorHosts();

  for (const { name, host } of hosts) {
    try {
      const raw = await infraMonitorTool.invoke({ action: "ping", host });
      const parsed = JSON.parse(raw);
      const isOffline = /OFFLINE|inalcançável/i.test(parsed.result || "");

      if (isOffline) {
        logger.warn(`monitor: host "${name}" (${host}) está offline`);
        await alertOnce(`host:${host}`, `🔴 Alerta: host "${name}" (${host}) está offline.`);
      }
    } catch (error) {
      logger.error(`monitor: erro ao checar host "${name}" (${host}): ${error.message}`);
    }
  }
}

async function checkUps() {
  const host = process.env.MONITOR_UPS_HOST;
  const oid = process.env.MONITOR_UPS_OID;
  const batteryValue = process.env.MONITOR_UPS_BATTERY_VALUE;

  if (!host || !oid || !batteryValue) return;

  try {
    const raw = await infraMonitorTool.invoke({ action: "snmp_get", host, oid });
    const parsed = JSON.parse(raw);

    if (parsed.error) {
      logger.error(`monitor: erro SNMP no nobreak ${host}: ${parsed.error}`);
      return;
    }

    if (String(parsed.result?.value) === batteryValue) {
      logger.warn(`monitor: nobreak em ${host} está em modo bateria`);
      await alertOnce(`ups:${host}`, `🔋 Alerta: o nobreak em ${host} entrou em modo bateria!`);
    }
  } catch (error) {
    logger.error(`monitor: erro ao checar nobreak ${host}: ${error.message}`);
  }
}

export async function runMonitorCheck() {
  await checkHosts();
  await checkUps();
}

export function startMonitor() {
  if (process.env.MONITOR_ENABLED !== "true") {
    logger.info("monitor: desabilitado (defina MONITOR_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(CRON_SCHEDULE, runMonitorCheck, { timezone: CRON_TIMEZONE });
  logger.info(`monitor: agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
}
