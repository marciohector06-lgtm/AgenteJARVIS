import { TavilySearch } from "@langchain/tavily";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";

// Upgrade de tiktokProductHunterTool.js (mantido intacto, não removido).
// Mesma limitação de origem: não existe API pública oficial do TikTok Shop
// pra dados reais de vendas/comissão/rating — o score aqui é heurístico,
// baseado em sinal de busca na web (Tavily), igual a tool original.
//
// "Scout do @sodre.luxe": não integrado — não tenho a especificação (URL,
// formato de request/resposta) dessa fonte de dados. Não fabriquei uma
// chamada pra um endpoint inventado; se você passar a doc/API real, dá pra
// plugar aqui depois (ponto marcado abaixo com scoutData: null).

const tavilySearch = new TavilySearch({ maxResults: 8 });

const TIKTOK_COMMISSION_RATE_DEFAULT = 0.05;
const PAYMENT_PROCESSING_RATE = 0.02;
const CPA_SAFETY_MARGIN_RATE = 0.3;

const HYPE_WORDS = ["viral", "trending", "esgotado", "sold out", "mais vendido", "tendência", "bestseller", "febre", "novidade"];
const TREND_RECENCY_WORDS = ["hoje", "essa semana", "recente", "lançamento"];

function calculateFinancials(estimatedCost, estimatedSalePrice, commissionRate) {
  const tiktokFees = estimatedSalePrice * (commissionRate + PAYMENT_PROCESSING_RATE);
  const cpaBudget = estimatedSalePrice * CPA_SAFETY_MARGIN_RATE;
  const netProfit = estimatedSalePrice - estimatedCost - tiktokFees - cpaBudget;
  const marginPercent = (netProfit / estimatedSalePrice) * 100;
  return { tiktokFees, cpaBudget, netProfit, marginPercent };
}

function calculateHypeScore(results, extraWords = []) {
  if (!results.length) return 1;
  const combinedText = results.map((r) => `${r.title} ${r.content}`).join(" ").toLowerCase();
  const words = [...HYPE_WORDS, ...extraWords];
  const hits = words.filter((word) => combinedText.includes(word)).length;
  const densityScore = Math.min(results.length * 1.5, 6);
  const hypeScore = Math.min(hits * 1, 4);
  return Math.max(1, Math.min(Math.round(densityScore + hypeScore), 10));
}

async function searchTavily(query) {
  try {
    const response = await tavilySearch.invoke({ query });
    const parsed = typeof response === "string" ? JSON.parse(response) : response;
    return parsed.results || [];
  } catch {
    return [];
  }
}

async function analyzeProduct({ productKeyword, estimatedCost, estimatedSalePrice, estimatedRating, commissionRate, minMarginPercent, category }) {
  const query = `"TikTok Shop" ${productKeyword} ${category || ""} comprar viral`.trim();
  const results = await searchTavily(query);

  const viralityScore = calculateHypeScore(results);
  const { tiktokFees, cpaBudget, netProfit, marginPercent } = calculateFinancials(
    estimatedCost,
    estimatedSalePrice,
    commissionRate ?? TIKTOK_COMMISSION_RATE_DEFAULT
  );

  const ratingScore = estimatedRating !== undefined ? Math.min(10, Math.round((estimatedRating / 5) * 10)) : null;
  const marginThreshold = minMarginPercent ?? 0;
  const isFinanciallyViable = netProfit > 0 && marginPercent >= marginThreshold;
  const hasStrongSignal = viralityScore >= 5;
  const hasGoodRating = ratingScore === null || ratingScore >= 6;

  const verdict = isFinanciallyViable && hasStrongSignal && hasGoodRating ? "✅ APROVAR PARA TESTE" : "❌ DESCARTAR";
  const reasons = [];
  if (!isFinanciallyViable) reasons.push(`margem (${marginPercent.toFixed(1)}%) abaixo do mínimo exigido (${marginThreshold}%)`);
  if (!hasStrongSignal) reasons.push("sinal fraco de demanda/viralidade na web");
  if (!hasGoodRating) reasons.push(`rating estimado baixo (${estimatedRating}/5)`);

  return {
    productKeyword,
    scores: { virality: viralityScore, rating: ratingScore, overall: Math.round(((viralityScore + (ratingScore ?? viralityScore)) / 2) * 10) / 10 },
    financials: {
      netProfitPerSale: Number(netProfit.toFixed(2)),
      marginPercent: Number(marginPercent.toFixed(1)),
      tiktokFees: Number(tiktokFees.toFixed(2)),
      cpaBudget: Number(cpaBudget.toFixed(2)),
    },
    verdict,
    reasons: reasons.length ? reasons : ["margem positiva, sinal de demanda consistente e rating adequado"],
    sources: results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })),
    scoutData: null, // integração "Scout do @sodre.luxe" não configurada/especificada
  };
}

async function detectTrends({ category, minMarginPercent }) {
  const query = `TikTok Shop produtos em alta ${category || ""} ${TREND_RECENCY_WORDS.join(" OR ")}`.trim();
  const results = await searchTavily(query);
  const hypeScore = calculateHypeScore(results, TREND_RECENCY_WORDS);

  return {
    category: category || "geral",
    hypeScore,
    trending: results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, resumo: r.content?.slice(0, 200) })),
    note: minMarginPercent
      ? `Filtro de margem mínima (${minMarginPercent}%) não se aplica aqui — trends não têm custo/preço definido ainda. Use action='analyze_product' pra cada item com custo/preço reais.`
      : undefined,
    scoutData: null,
  };
}

export const tiktokShopTool = tool(
  async ({ action, productKeyword, estimatedCost, estimatedSalePrice, estimatedRating, commissionRate, minMarginPercent, category }) => {
    try {
      if (action === "analyze_product") {
        if (!productKeyword || estimatedCost === undefined || estimatedSalePrice === undefined) {
          return "productKeyword, estimatedCost e estimatedSalePrice são obrigatórios para action='analyze_product'.";
        }
        const result = await analyzeProduct({ productKeyword, estimatedCost, estimatedSalePrice, estimatedRating, commissionRate, minMarginPercent, category });
        logger.info(`tiktok_shop_tool action=analyze_product productKeyword="${productKeyword}" verdict=${result.verdict}`);
        return JSON.stringify(result);
      }

      if (action === "detect_trends") {
        const result = await detectTrends({ category, minMarginPercent });
        logger.info(`tiktok_shop_tool action=detect_trends category=${category || "geral"}`);
        return JSON.stringify(result);
      }

      return `Ação "${action}" inválida. Use: analyze_product, detect_trends.`;
    } catch (error) {
      logger.error(`tiktok_shop_tool action=${action} erro=${error.message}`);
      return `Erro em tiktok_shop_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "tiktok_shop_tool",
    description:
      "Versão expandida de tiktok_product_hunter. 'analyze_product': score completo (viralidade heurística + margem líquida + rating estimado), com filtro de margem mínima e categoria. 'detect_trends': busca produtos em alta numa categoria, com sinal de recência. Nota: sem API pública do TikTok Shop, todo score é heurístico baseado em busca web — não são dados reais de vendas.",
    schema: z.object({
      action: z.enum(["analyze_product", "detect_trends"]).describe("Ação a executar"),
      productKeyword: z.string().optional().describe("Nome/palavra-chave do produto, necessário para action='analyze_product'"),
      estimatedCost: z.number().optional().describe("Custo estimado do produto (R$), necessário para action='analyze_product'"),
      estimatedSalePrice: z.number().optional().describe("Preço de venda estimado (R$), necessário para action='analyze_product'"),
      estimatedRating: z.number().optional().describe("Rating estimado do produto (0-5), opcional em action='analyze_product'"),
      commissionRate: z.number().optional().describe("Taxa de comissão do TikTok Shop (padrão: 0.05 = 5%)"),
      minMarginPercent: z.number().optional().describe("Margem líquida mínima (%) exigida pra aprovar o produto"),
      category: z.string().optional().describe("Categoria do produto, usada pra refinar a busca em ambas as ações"),
    }),
  }
);
