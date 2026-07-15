import { listBackups } from "../tools/disasterRecoveryTool.js";
import { getRecentKnowledge } from "../memory/index.js";
import { getProfileFacts } from "../memory/profileManager.js";
import { logger } from "../logger.js";

const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // mesmo limiar usado em proactive/followup.js
const RECENT_KNOWLEDGE_DAYS = 7;

function getLastBackup() {
  const destination = process.env.BACKUP_DESTINATION;
  if (!destination) return null;

  const backups = listBackups(destination);
  return backups[0] || null;
}

async function getRecentScraperKnowledge() {
  const since = new Date(Date.now() - RECENT_KNOWLEDGE_DAYS * 86_400_000).toISOString();

  try {
    const items = await getRecentKnowledge(since);
    return items.slice(0, 10).map((item) => ({
      document: item.document?.slice(0, 200) || "",
      topic: item.metadata?.topic || null,
      source: item.metadata?.source || null,
      date: item.metadata?.date || null,
    }));
  } catch (error) {
    logger.error(`dashboard: erro ao buscar conhecimento recente: ${error.message}`);
    return [];
  }
}

function getPendingProfileTasks() {
  const now = Date.now();

  return getProfileFacts()
    .filter((fact) => fact.category === "goals" || fact.category === "projects")
    .map((fact) => ({
      category: fact.category,
      key: fact.key,
      value: fact.value,
      updatedAt: fact.updatedAt,
      stale: now - fact.updatedAt > STALE_THRESHOLD_MS,
    }));
}

function getServerInfo(connectedSessions) {
  const memoryUsage = process.memoryUsage();

  return {
    uptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryUsageMB: Math.round(memoryUsage.rss / 1024 / 1024),
    connectedSessions,
  };
}

export async function buildDashboard(connectedSessions) {
  const [recentKnowledge, pendingTasks] = await Promise.all([
    getRecentScraperKnowledge(),
    Promise.resolve(getPendingProfileTasks()),
  ]);

  return {
    server: getServerInfo(connectedSessions),
    lastBackup: getLastBackup(),
    recentKnowledge,
    pendingTasks,
  };
}
