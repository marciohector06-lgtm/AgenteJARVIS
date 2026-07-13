import { TavilySearch } from "@langchain/tavily";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const tavilySearch = new TavilySearch({ maxResults: 5 });

const SEARCH_MODIFIERS = {
  viral_video: "site:tiktok.com OR site:instagram.com/reels OR site:youtube.com/shorts",
  product: 'site:myshopify.com OR "comprar" OR "oferta"',
};

export const viralTrendSearchTool = tool(
  async ({ query, searchType }) => {
    const augmentedQuery = `${query} ${SEARCH_MODIFIERS[searchType]}`;

    let response;
    try {
      response = await tavilySearch.invoke({ query: augmentedQuery });
    } catch {
      return "Não foi possível completar a busca agora. Tente novamente em instantes.";
    }

    const results = typeof response === "string" ? JSON.parse(response).results : response.results;

    if (!Array.isArray(results) || results.length === 0) {
      return "Nenhum resultado encontrado para essa busca.";
    }

    return results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.title}\nLink: ${r.url}\nResumo: ${r.content}`)
      .join("\n\n");
  },
  {
    name: "viral_trend_search",
    description:
      "Inteligência competitiva na web: encontra produtos em alta (searchType='product') ou vídeos virais no TikTok/Reels/Shorts (searchType='viral_video'), evitando resultados genéricos de SEO. Use para pesquisas de tendências de marketing.",
    schema: z.object({
      query: z.string().describe("Termo de busca, ex: nicho ou produto"),
      searchType: z
        .enum(["product", "viral_video"])
        .describe(
          "'product' para achar produtos em alta, 'viral_video' para achar vídeos virais"
        ),
    }),
  }
);
