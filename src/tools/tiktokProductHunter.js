import { TavilySearch } from "@langchain/tavily";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const tavilySearch = new TavilySearch({ maxResults: 8 });

const TIKTOK_COMMISSION_RATE = 0.05;
const PAYMENT_PROCESSING_RATE = 0.02;
const CPA_SAFETY_MARGIN_RATE = 0.3;

const HYPE_WORDS = [
  "viral",
  "trending",
  "esgotado",
  "sold out",
  "mais vendido",
  "tendência",
  "bestseller",
  "febre",
];

function calculateFinancials(estimatedCost, estimatedSalePrice) {
  const tiktokFees = estimatedSalePrice * (TIKTOK_COMMISSION_RATE + PAYMENT_PROCESSING_RATE);
  const cpaBudget = estimatedSalePrice * CPA_SAFETY_MARGIN_RATE;
  const netProfit = estimatedSalePrice - estimatedCost - tiktokFees - cpaBudget;
  const marginPercent = (netProfit / estimatedSalePrice) * 100;
  return { tiktokFees, cpaBudget, netProfit, marginPercent };
}

function calculateViralityScore(results) {
  if (!results.length) return 1;

  const combinedText = results
    .map((r) => `${r.title} ${r.content}`)
    .join(" ")
    .toLowerCase();

  const hypeHits = HYPE_WORDS.filter((word) => combinedText.includes(word)).length;

  const densityScore = Math.min(results.length * 1.5, 6);
  const hypeScore = Math.min(hypeHits * 1, 4);

  return Math.max(1, Math.min(Math.round(densityScore + hypeScore), 10));
}

export const tiktokProductHunterTool = tool(
  async ({ productKeyword, estimatedCost, estimatedSalePrice }) => {
    const query = `"TikTok Shop" ${productKeyword} comprar viral`;

    let results = [];
    try {
      const response = await tavilySearch.invoke({ query });
      const parsed = typeof response === "string" ? JSON.parse(response) : response;
      results = parsed.results || [];
    } catch {
      // segue com results vazio — o score cai para o mínimo e o veredito reflete isso
    }

    const viralityScore = calculateViralityScore(results);
    const { tiktokFees, cpaBudget, netProfit, marginPercent } = calculateFinancials(
      estimatedCost,
      estimatedSalePrice
    );

    const isFinanciallyViable = netProfit > 0;
    const hasStrongSignal = viralityScore >= 5;
    const verdict =
      isFinanciallyViable && hasStrongSignal
        ? "✅ APROVAR PARA TESTE"
        : "❌ DESCARTAR";

    const reason = !isFinanciallyViable
      ? "margem líquida negativa depois de taxas e CPA de segurança"
      : !hasStrongSignal
        ? "sinal fraco de demanda/viralidade na web"
        : "margem positiva e sinal de demanda consistente";

    const topSources = results
      .slice(0, 3)
      .map((r, i) => `  ${i + 1}. ${r.title} — ${r.url}`)
      .join("\n");

    return `Produto Encontrado: ${productKeyword}
Nota de Viralidade (1 a 10): ${viralityScore}
Lucro Líquido Estimado por Venda: R$ ${netProfit.toFixed(2)} (margem de ${marginPercent.toFixed(1)}%)
  Custo do produto: R$ ${estimatedCost.toFixed(2)}
  Taxas TikTok Shop (comissão 5% + processamento 2%): R$ ${tiktokFees.toFixed(2)}
  Reserva de CPA (tráfego pago, 30% do preço de venda): R$ ${cpaBudget.toFixed(2)}
Veredito: ${verdict} — ${reason}
${topSources ? `\nFontes usadas no sinal de viralidade:\n${topSources}` : ""}

Nota: a Nota de Viralidade é um score heurístico baseado em densidade e tom dos resultados de busca na web (não há API oficial pública do TikTok Shop para dados reais de vendas).`;
  },
  {
    name: "tiktok_product_hunter",
    description:
      "Minera um produto para TikTok Shop: busca sinal de demanda/viralidade na web e calcula lucro líquido por venda descontando taxas do TikTok (comissão + processamento) e uma reserva de CPA de tráfego pago, retornando um veredito de aprovar ou descartar o teste.",
    schema: z.object({
      productKeyword: z.string().describe("Nome ou palavra-chave do produto a ser analisado"),
      estimatedCost: z.number().describe("Custo estimado do produto (em R$)"),
      estimatedSalePrice: z.number().describe("Preço de venda estimado (em R$)"),
    }),
  }
);
