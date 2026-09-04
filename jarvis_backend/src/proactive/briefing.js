import cron from "node-cron";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { getRecentKnowledge } from "../memory/index.js";
import { getProfileFacts } from "../memory/profileManager.js";
import { notifyWhatsApp } from "./whatsappNotifier.js";
import { metaAdsTool } from "../tools/metaAdsTool.js";
import { vercelTool } from "../tools/vercelTool.js";
import { tailscaleManagerTool } from "../tools/tailscaleManagerTool.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const CRON_SCHEDULE = "0 8 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";

const briefingModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

async function invokeBriefingModel(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < briefingModels.length; i++) {
    try {
      const response = await briefingModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === briefingModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `briefing cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function yesterdayISODate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date.toISOString().slice(0, 10);
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

function countConversions(actions) {
  if (!Array.isArray(actions)) return 0;
  const purchase = actions.find((a) => a.action_type === "purchase" || a.action_type === "omni_purchase");
  return purchase ? Number(purchase.value) || 0 : 0;
}

async function getMetaAdsSummary() {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_AD_ACCOUNT_ID) {
    return "Meta Ads não configurado (META_ACCESS_TOKEN/META_AD_ACCOUNT_ID ausentes no .env).";
  }

  try {
    const since = yesterdayISODate();
    const raw = await metaAdsTool.invoke({ action: "get_insights", since, until: since });
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length === 0) return "Nenhum dado de campanha ontem.";

    const totalSpend = rows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0);
    const totalConversions = rows.reduce((sum, r) => sum + countConversions(r.actions), 0);
    const avgCpm = rows.reduce((sum, r) => sum + (Number(r.cpm) || 0), 0) / rows.length;

    return `Gasto total: R$${totalSpend.toFixed(2)} | CPM médio: R$${avgCpm.toFixed(2)} | Conversões: ${totalConversions} | ${rows.length} linha(s) de campanha ativas.`;
  } catch (error) {
    logger.error(`briefing: erro ao buscar Meta Ads: ${error.message}`);
    return `Erro ao buscar Meta Ads: ${error.message}`;
  }
}

async function getWindowsPcsSummary() {
  const pcs = parseMonitoredWindowsPcs();
  if (pcs.length === 0) return "Nenhum PC configurado em MONITORED_WINDOWS_PCS.";

  try {
    const raw = await tailscaleManagerTool.invoke({ action: "list_devices" });
    const devices = JSON.parse(raw);
    if (!Array.isArray(devices)) return "Não foi possível ler status dos PCs via Tailscale.";

    const onlineHostnames = new Set(devices.filter((d) => d.online).map((d) => d.hostname?.toLowerCase()));
    const onlineCount = pcs.filter((pc) => onlineHostnames.has(pc.host.toLowerCase()) || onlineHostnames.has(pc.name.toLowerCase())).length;

    return `${onlineCount}/${pcs.length} PCs online.`;
  } catch (error) {
    logger.error(`briefing: erro ao buscar status dos PCs: ${error.message}`);
    return `Erro ao buscar status dos PCs: ${error.message}`;
  }
}

async function getVercelSummary() {
  if (!process.env.VERCEL_TOKEN) return "Vercel não configurado (VERCEL_TOKEN ausente no .env).";

  const projects = (process.env.VERCEL_BRIEFING_PROJECTS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  if (projects.length === 0) return "Nenhum projeto configurado em VERCEL_BRIEFING_PROJECTS.";

  const summaries = await Promise.all(
    projects.map(async (project) => {
      try {
        const raw = await vercelTool.invoke({ action: "list_deployments", project, limit: 1 });
        const deployments = JSON.parse(raw);
        const latest = deployments[0];
        return latest ? `${project}: ${latest.state}` : `${project}: sem deploys`;
      } catch (error) {
        return `${project}: erro (${error.message})`;
      }
    })
  );

  return summaries.join(" | ");
}

// "Prazos UCB": fonte de dados ainda não definida (não é API nenhuma
// conhecida) — lendo por enquanto da categoria "ucb_deadlines" do perfil
// vivo (user_profile), que é preenchida manualmente via /perfil ou
// user:update_profile até haver uma fonte real definida.
function getUcbDeadlines() {
  const facts = getProfileFacts().filter((fact) => fact.category === "ucb_deadlines");
  if (facts.length === 0) return "Nenhum prazo UCB configurado (fonte de dados ainda não definida — registrado manualmente no perfil por enquanto).";
  return facts.map((fact) => `- ${fact.key}: ${fact.value}`).join("\n");
}

export async function runBriefing() {
  logger.info("briefing: iniciando geração do briefing diário");

  try {
    const [knowledge, metaAdsSummary, windowsPcsSummary, vercelSummary] = await Promise.all([
      getRecentKnowledge(yesterdayISODate()),
      getMetaAdsSummary(),
      getWindowsPcsSummary(),
      getVercelSummary(),
    ]);

    const pendingFacts = getProfileFacts().filter(
      (fact) => fact.category === "goals" || fact.category === "projects"
    );

    const knowledgeText = knowledge.length
      ? knowledge.map((item) => `- [${item.metadata.topic}] ${item.document.slice(0, 300)}`).join("\n")
      : "Nenhuma novidade relevante nas últimas 24h.";

    const tasksText = pendingFacts.length
      ? pendingFacts.map((fact) => `- (${fact.category}) ${fact.key}: ${fact.value}`).join("\n")
      : "Nenhuma meta/projeto registrado no perfil ainda.";

    const prompt = `Você é o J.A.R.V.I.S. gerando o briefing matinal do usuário. Seja direto e denso.

Novidades relevantes das últimas 24h (pesquisa automática):
${knowledgeText}

Meta Ads (dados de ontem):
${metaAdsSummary}

Status dos PCs Windows:
${windowsPcsSummary}

Status dos deploys Vercel:
${vercelSummary}

Prazos UCB próximos:
${getUcbDeadlines()}

Metas e projetos em aberto do usuário:
${tasksText}

Gere um briefing curto (máximo 250 palavras) em português com:
1. Resumo das novidades relevantes (se houver)
2. Meta Ads: como foi ontem
3. Infra: PCs e deploys ok?
4. Prazos UCB, se houver
5. UMA sugestão de ação prioritária pra hoje, considerando tudo acima

Seja objetivo, sem enrolação. Não use markdown de título, só texto corrido com quebras de linha.`;

    const briefingText = await invokeBriefingModel(prompt);
    const sent = await notifyWhatsApp(`☀️ Briefing do dia\n\n${briefingText}`);

    // Push notification pro app: ainda não implementado (não há registro de
    // push token de dispositivo em lugar nenhum do projeto ainda). Quando o
    // app tiver expo-notifications configurado, plugar o envio aqui.

    if (sent) {
      logger.info("briefing: enviado com sucesso");
    } else {
      logger.error("briefing: gerado mas NÃO foi entregue no WhatsApp");
    }
  } catch (error) {
    logger.error(`briefing: erro ao gerar/enviar: ${error.message}`);
  }
}

export function startBriefing() {
  if (process.env.BRIEFING_ENABLED !== "true") {
    logger.info("briefing: desabilitado (defina BRIEFING_ENABLED=true no .env pra ativar)");
    return;
  }

  cron.schedule(CRON_SCHEDULE, runBriefing, { timezone: CRON_TIMEZONE });
  logger.info(`briefing: agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
}
