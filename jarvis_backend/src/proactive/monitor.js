import cron from "node-cron";
import { infraMonitorTool } from "../tools/infraMonitorTool.js";
import { metaAdsTool } from "../tools/metaAdsTool.js";
import { tailscaleManagerTool } from "../tools/tailscaleManagerTool.js";
import { listSatellites } from "../satellite/satelliteManager.js";
import { logger } from "../logger.js";
import { notifyWhatsApp } from "./whatsappNotifier.js";

const CRON_SCHEDULE = "*/5 * * * *";
const META_ADS_CRON_SCHEDULE = "0 */2 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

const CPM_ALERT_INCREASE_PERCENT = Number(process.env.META_CPM_ALERT_INCREASE_PERCENT) || 30;
const CTR_ALERT_THRESHOLD_PERCENT = Number(process.env.META_CTR_ALERT_THRESHOLD) || 1;

const lastAlertAt = new Map();
// Baseline em memória (não persistido — reinicia com o processo, igual
// lastAlertAt). É comparação "desde a última checagem", não histórico fixo.
const metaCampaignBaseline = new Map();

async function alertOnce(key, message) {
  const now = Date.now();
  const last = lastAlertAt.get(key);

  if (last && now - last < ALERT_COOLDOWN_MS) {
    return;
  }

  lastAlertAt.set(key, now);
  const sent = await notifyWhatsApp(message);
  if (!sent) {
    logger.error(`monitor: alerta "${key}" NÃO foi entregue no WhatsApp`);
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

function parseMonitoredWindowsPcs() {
  return (process.env.MONITORED_WINDOWS_PCS || "")
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

async function checkWindowsPcs() {
  const pcs = parseMonitoredWindowsPcs();
  if (pcs.length === 0) return;

  try {
    const raw = await tailscaleManagerTool.invoke({ action: "list_devices" });
    const devices = JSON.parse(raw);
    if (!Array.isArray(devices)) {
      logger.error(`monitor: tailscale_manager_tool não retornou uma lista de dispositivos: ${raw}`);
      return;
    }

    const onlineHostnames = new Set(devices.filter((d) => d.online).map((d) => d.hostname?.toLowerCase()));

    for (const { name, host } of pcs) {
      const isOnline = onlineHostnames.has(host.toLowerCase()) || onlineHostnames.has(name.toLowerCase());
      if (!isOnline) {
        logger.warn(`monitor: PC "${name}" (${host}) aparenta offline na tailnet`);
        await alertOnce(`pc:${host}`, `🔴 Alerta: PC "${name}" (${host}) está offline na Tailscale.`);
      }
    }
  } catch (error) {
    logger.error(`monitor: erro ao checar PCs via Tailscale: ${error.message}`);
  }
}

async function checkSatelliteHeartbeat() {
  try {
    const satellites = listSatellites();
    for (const satellite of satellites) {
      if (satellite.status === "offline") {
        await alertOnce(
          `satellite:${satellite.id}`,
          `🔴 Alerta: satélite "${satellite.name}" (${satellite.id}) perdeu o heartbeat — está offline.`
        );
      }
    }
  } catch (error) {
    logger.error(`monitor: erro ao checar heartbeat de satélites: ${error.message}`);
  }
}

export async function runMonitorCheck() {
  await checkHosts();
  await checkUps();
  await checkWindowsPcs();
  await checkSatelliteHeartbeat();
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

async function checkMetaAdsCampaign(campaign) {
  const since = todayISODate();
  const raw = await metaAdsTool.invoke({ action: "get_insights", campaignId: campaign.id, since, until: since });
  const insights = JSON.parse(raw);
  if (!Array.isArray(insights) || insights.length === 0) return;

  const row = insights[0];
  const cpm = Number(row.cpm);
  const ctr = Number(row.ctr);
  const spend = Number(row.spend);

  const baseline = metaCampaignBaseline.get(campaign.id);
  if (baseline && Number.isFinite(cpm) && cpm >= baseline.cpm * (1 + CPM_ALERT_INCREASE_PERCENT / 100)) {
    await alertOnce(
      `meta_cpm:${campaign.id}`,
      `📈 Alerta Meta Ads: CPM da campanha "${campaign.name}" subiu ${(((cpm - baseline.cpm) / baseline.cpm) * 100).toFixed(0)}% (de R$${baseline.cpm.toFixed(2)} pra R$${cpm.toFixed(2)}).`
    );
  }

  if (Number.isFinite(ctr) && ctr < CTR_ALERT_THRESHOLD_PERCENT) {
    await alertOnce(
      `meta_ctr:${campaign.id}`,
      `📉 Alerta Meta Ads: CTR da campanha "${campaign.name}" está em ${ctr.toFixed(2)}%, abaixo do mínimo (${CTR_ALERT_THRESHOLD_PERCENT}%).`
    );
  }

  if (campaign.daily_budget && Number.isFinite(spend)) {
    const dailyBudgetReais = Number(campaign.daily_budget) / 100;
    if (spend >= dailyBudgetReais * 0.95) {
      await alertOnce(
        `meta_budget:${campaign.id}`,
        `💸 Alerta Meta Ads: campanha "${campaign.name}" já gastou R$${spend.toFixed(2)} de um orçamento diário de R$${dailyBudgetReais.toFixed(2)} (perto de esgotar).`
      );
    }
  }

  if (Number.isFinite(cpm)) {
    metaCampaignBaseline.set(campaign.id, { cpm, checkedAt: Date.now() });
  }
}

export async function runMetaAdsCheck() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    logger.warn("monitor: META_ACCESS_TOKEN/META_AD_ACCOUNT_ID não configurados, pulando checagem de Meta Ads");
    return;
  }

  try {
    const raw = await metaAdsTool.invoke({ action: "list_campaigns" });
    const campaigns = JSON.parse(raw);
    if (!Array.isArray(campaigns)) {
      logger.error(`monitor: meta_ads_tool não retornou uma lista de campanhas: ${raw}`);
      return;
    }

    const activeCampaigns = campaigns.filter((c) => c.effective_status === "ACTIVE");
    for (const campaign of activeCampaigns) {
      try {
        await checkMetaAdsCampaign(campaign);
      } catch (error) {
        logger.error(`monitor: erro ao checar campanha "${campaign.name}": ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`monitor: erro ao listar campanhas Meta Ads: ${error.message}`);
  }
}

export function startMonitor() {
  if (process.env.MONITOR_ENABLED !== "true") {
    logger.info("monitor: desabilitado (defina MONITOR_ENABLED=true no .env pra ativar)");
  } else {
    cron.schedule(CRON_SCHEDULE, runMonitorCheck, { timezone: CRON_TIMEZONE });
    logger.info(`monitor: agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE}) — hosts, UPS, PCs Windows e heartbeat de satélites`);
  }

  if (process.env.META_ADS_MONITOR_ENABLED !== "true") {
    logger.info("monitor: monitor de Meta Ads desabilitado (defina META_ADS_MONITOR_ENABLED=true no .env pra ativar)");
  } else {
    cron.schedule(META_ADS_CRON_SCHEDULE, runMetaAdsCheck, { timezone: CRON_TIMEZONE });
    logger.info(`monitor: Meta Ads agendado (cron "${META_ADS_CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
  }
}
