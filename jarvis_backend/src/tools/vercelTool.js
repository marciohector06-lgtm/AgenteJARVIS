import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// Vercel REST API real (api.vercel.com, documentada em vercel.com/docs/rest-api).
const VERCEL_API = "https://api.vercel.com";

// Mapeia nome de projeto -> projectId, opcional. Se VERCEL_PROJECTS não
// estiver configurado, "project" é tratado como o próprio nome/ID do
// projeto direto (a API da Vercel aceita name OU id na maioria dos endpoints).
function resolveProjectId(project) {
  if (!project) return null;
  try {
    const map = JSON.parse(process.env.VERCEL_PROJECTS || "{}");
    return map[project] || project;
  } catch {
    return project;
  }
}

function authHeaders() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) throw new Error("VERCEL_TOKEN não configurado no .env.");
  return { Authorization: `Bearer ${token}` };
}

function withTeamParam(url) {
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  return url;
}

async function vercelRequest(path, { method = "GET", params = {}, body } = {}) {
  const url = withTeamParam(new URL(`${VERCEL_API}${path}`));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const init = { method, headers: { ...authHeaders() } };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`Vercel API respondeu HTTP ${response.status}: ${json.error?.message || JSON.stringify(json)}`);
  }

  return json;
}

async function listDeployments(project, limit) {
  const projectId = resolveProjectId(project);
  const json = await vercelRequest("/v6/deployments", { params: { projectId, limit: limit || 10 } });
  return (json.deployments || []).map((d) => ({
    id: d.uid,
    name: d.name,
    url: d.url,
    state: d.state,
    target: d.target,
    createdAt: new Date(d.created).toISOString(),
  }));
}

async function getLogs(deploymentId) {
  const json = await vercelRequest(`/v2/deployments/${deploymentId}/events`, { params: { limit: 200 } });
  const events = Array.isArray(json) ? json : json.events || [];
  return events
    .filter((e) => e.type === "stdout" || e.type === "stderr" || /error/i.test(e.payload?.text || ""))
    .map((e) => ({ type: e.type, text: e.payload?.text || "", createdAt: e.created ? new Date(e.created).toISOString() : null }));
}

async function redeploy(deploymentId, name, target) {
  return vercelRequest("/v13/deployments", {
    method: "POST",
    body: { name, deploymentId, target: target || "production" },
  });
}

export const vercelTool = tool(
  async ({ action, project, deploymentId, limit, target }) => {
    try {
      if (action === "list_deployments") {
        if (!project) return "project é obrigatório para action='list_deployments'.";
        const deployments = await listDeployments(project, limit);
        logger.info(`vercel_tool action=list_deployments project=${project} total=${deployments.length}`);
        return JSON.stringify(deployments);
      }

      if (action === "get_logs") {
        if (!deploymentId) return "deploymentId é obrigatório para action='get_logs'.";
        const logs = await getLogs(deploymentId);
        logger.info(`vercel_tool action=get_logs deploymentId=${deploymentId} eventos=${logs.length}`);
        return JSON.stringify(logs);
      }

      if (action === "redeploy") {
        if (!project || !deploymentId) return "project e deploymentId são obrigatórios para action='redeploy'.";
        return await guardExecution(`Redeploy do projeto "${project}" a partir do deployment ${deploymentId}`, { destructive: true }, async () => {
          const result = await redeploy(deploymentId, project, target);
          logger.info(`vercel_tool action=redeploy project=${project} deploymentId=${deploymentId}`);
          return JSON.stringify(result);
        });
      }

      return `Ação "${action}" inválida. Use: list_deployments, get_logs, redeploy.`;
    } catch (error) {
      logger.error(`vercel_tool action=${action} erro=${error.message}`);
      return `Erro em vercel_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "vercel_tool",
    description:
      "Gerencia deploys Vercel via API REST real. 'list_deployments': status de todos os deploys de um projeto (name ou id — configure VERCEL_PROJECTS no .env como JSON {\"ShopSpy\":\"prj_xxx\"} pra usar apelidos). 'get_logs': eventos de build/erro de um deployment específico (deploymentId). 'redeploy': dispara um novo deploy a partir de um deployment existente (destrutivo, pede confirmação).",
    schema: z.object({
      action: z.enum(["list_deployments", "get_logs", "redeploy"]).describe("Ação a executar"),
      project: z.string().optional().describe("Nome ou ID do projeto Vercel (ex: ShopSpy, TikTok Shop Revelado, UCB)"),
      deploymentId: z.string().optional().describe("ID do deployment, necessário para get_logs/redeploy"),
      limit: z.number().optional().describe("Quantidade de deploys a retornar em list_deployments (padrão: 10)"),
      target: z.enum(["production", "preview"]).optional().describe("Ambiente do redeploy (padrão: production)"),
    }),
  }
);
