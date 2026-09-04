import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// Implementado contra a Graph API de Marketing da Meta (graph.facebook.com),
// que é real, pública e documentada em developers.facebook.com/docs/marketing-apis.
// "mcp.facebook.com/ads" (citado no pedido) não é um endpoint que eu consigo
// verificar como existente — não construí nada contra ele.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function resolveAdAccountId(adAccountId) {
  const id = adAccountId || process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error("adAccountId não informado e META_AD_ACCOUNT_ID não configurado no .env.");
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function graphRequest(path, { method = "GET", params = {}, body } = {}) {
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) throw new Error("META_ACCESS_TOKEN não configurado no .env.");

  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }

  const init = { method, headers: {} };
  if (method === "GET") {
    url.searchParams.set("access_token", accessToken);
  } else {
    init.headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams({ ...body, access_token: accessToken }).toString();
  }

  const response = await fetch(url, init);
  const json = await response.json();

  if (json.error) {
    throw new Error(`Meta Graph API: ${json.error.message} (code ${json.error.code}${json.error.error_subcode ? `, subcode ${json.error.error_subcode}` : ""})`);
  }

  return json;
}

async function listCampaigns(adAccountId) {
  const account = resolveAdAccountId(adAccountId);
  const json = await graphRequest(`${account}/campaigns`, {
    params: { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget" },
  });
  return json.data || [];
}

async function getInsights({ targetId, adAccountId, since, until }) {
  const target = targetId || resolveAdAccountId(adAccountId);
  const json = await graphRequest(`${target}/insights`, {
    params: {
      fields: "campaign_name,adset_name,spend,cpm,cpc,ctr,impressions,clicks,actions",
      time_range: JSON.stringify({ since, until }),
    },
  });
  return json.data || [];
}

async function toggleAdset(adsetId, status) {
  return graphRequest(adsetId, { method: "POST", body: { status } });
}

async function pixelStatus(pixelId) {
  const json = await graphRequest(pixelId, {
    params: { fields: "id,name,last_fired_time,is_created_by_business,data_use_restrictions" },
  });

  return {
    ...json,
    note:
      "last_fired_time reflete eventos de navegador (Pixel). A Graph API não expõe um campo público único e confiável pra 'status da CAPI' isolado — pra confirmar eventos server-side de verdade, veja Eventos Manager > Visão geral de eventos no próprio Meta Business Suite.",
  };
}

export const metaAdsTool = tool(
  async ({ action, adAccountId, campaignId, adsetId, pixelId, status, since, until, sinceB, untilB }) => {
    try {
      if (action === "list_campaigns") {
        const campaigns = await listCampaigns(adAccountId);
        logger.info(`meta_ads_tool action=list_campaigns total=${campaigns.length}`);
        return JSON.stringify(campaigns);
      }

      if (action === "get_insights") {
        if (!since || !until) return "since e until (YYYY-MM-DD) são obrigatórios para action='get_insights'.";
        const targetId = adsetId || campaignId;
        const insights = await getInsights({ targetId, adAccountId, since, until });
        logger.info(`meta_ads_tool action=get_insights since=${since} until=${until} linhas=${insights.length}`);
        return JSON.stringify(insights);
      }

      if (action === "compare_periods") {
        if (!since || !until || !sinceB || !untilB) {
          return "since/until (período A) e sinceB/untilB (período B) são obrigatórios para action='compare_periods'.";
        }
        const targetId = adsetId || campaignId;
        const [periodA, periodB] = await Promise.all([
          getInsights({ targetId, adAccountId, since, until }),
          getInsights({ targetId, adAccountId, since: sinceB, until: untilB }),
        ]);
        logger.info(`meta_ads_tool action=compare_periods`);
        return JSON.stringify({ periodA: { since, until, data: periodA }, periodB: { since: sinceB, until: untilB, data: periodB } });
      }

      if (action === "toggle_adset") {
        if (!adsetId || !status) return "adsetId e status ('ACTIVE' ou 'PAUSED') são obrigatórios para action='toggle_adset'.";
        return await guardExecution(`Mudar status do ad set ${adsetId} para ${status}`, { destructive: true }, async () => {
          const result = await toggleAdset(adsetId, status);
          logger.info(`meta_ads_tool action=toggle_adset adsetId=${adsetId} status=${status}`);
          return JSON.stringify(result);
        });
      }

      if (action === "pixel_status") {
        if (!pixelId) return "pixelId é obrigatório para action='pixel_status'.";
        const result = await pixelStatus(pixelId);
        logger.info(`meta_ads_tool action=pixel_status pixelId=${pixelId}`);
        return JSON.stringify(result);
      }

      return `Ação "${action}" inválida. Use: list_campaigns, get_insights, compare_periods, toggle_adset, pixel_status.`;
    } catch (error) {
      logger.error(`meta_ads_tool action=${action} erro=${error.message}`);
      return `Erro em meta_ads_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "meta_ads_tool",
    description:
      "Gerencia campanhas Meta Ads via Graph API de Marketing real (graph.facebook.com). 'list_campaigns': lista campanhas da conta com status/objetivo/orçamento. 'get_insights': CPM/CPC/CTR/gasto/impressões/cliques num período (since/until YYYY-MM-DD), no nível de conta, campanha (campaignId) ou ad set (adsetId). 'compare_periods': roda get_insights duas vezes (período A e B) pra comparar. 'toggle_adset': pausa/ativa um ad set (destrutivo, pede confirmação). 'pixel_status': status básico do Pixel (last_fired_time) — não expõe status de CAPI isolado, ver nota no retorno.",
    schema: z.object({
      action: z.enum(["list_campaigns", "get_insights", "compare_periods", "toggle_adset", "pixel_status"]).describe("Ação a executar"),
      adAccountId: z.string().optional().describe("ID da conta de anúncios (com ou sem prefixo 'act_'). Padrão: META_AD_ACCOUNT_ID do .env"),
      campaignId: z.string().optional().describe("ID da campanha, pra escopar get_insights/compare_periods"),
      adsetId: z.string().optional().describe("ID do ad set, necessário para toggle_adset; opcional pra escopar get_insights/compare_periods"),
      pixelId: z.string().optional().describe("ID do Pixel, necessário para pixel_status"),
      status: z.enum(["ACTIVE", "PAUSED"]).optional().describe("Novo status do ad set, necessário para toggle_adset"),
      since: z.string().optional().describe("Data inicial YYYY-MM-DD (período A em compare_periods)"),
      until: z.string().optional().describe("Data final YYYY-MM-DD (período A em compare_periods)"),
      sinceB: z.string().optional().describe("Data inicial do período B, necessário para compare_periods"),
      untilB: z.string().optional().describe("Data final do período B, necessário para compare_periods"),
    }),
  }
);
