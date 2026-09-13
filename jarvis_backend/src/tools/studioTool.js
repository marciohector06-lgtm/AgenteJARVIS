import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { listOffers, createOffer, getOffer } from "../studio/offers.js";
import { listBaseVideos } from "../studio/baseVideos.js";
import { offerReadiness, produceVideoForOffer } from "../studio/producer.js";
import { pendingApprovals, listRecent } from "../studio/pipeline.js";
import { formulaPerformance } from "../studio/measurement.js";
import { countMinedHooks, searchMinedHooks } from "../studio/hookStore.js";
import { mineHooksForNiche } from "../studio/hookAnalyzer.js";

function describeOffers() {
  const offers = listOffers();

  if (offers.length === 0) return "Nenhuma oferta cadastrada. Use action='criar_oferta' para cadastrar a primeira.";

  return offers
    .map((offer) => {
      const readiness = offerReadiness(offer.id);
      const videos = listBaseVideos(offer.id).length;
      const status = offer.active ? (readiness.ready ? "pronta" : `bloqueada: ${readiness.reason}`) : "pausada";
      return `- ${offer.id}: ${offer.productName.slice(0, 60)} | ${offer.category} | ${videos} vídeo(s) base | ${status}`;
    })
    .join("\n");
}

function describeQueue() {
  const pending = pendingApprovals();

  if (pending.length === 0) return "Fila de aprovação vazia.";

  return [
    `${pending.length} vídeo(s) aguardando sua aprovação no app:`,
    ...pending.map((video) => `- ${video.id.slice(0, 8)}: "${video.script?.hook || "sem gancho"}"`),
  ].join("\n");
}

function describePerformance() {
  const linhas = formulaPerformance();

  if (linhas.length === 0) return "Ainda não há decisões registradas — aprove ou descarte alguns vídeos primeiro.";

  return [
    `Desempenho por fórmula de gancho (${countMinedHooks()} ganchos minerados no banco):`,
    ...linhas.map(
      (l) =>
        `- ${l.hookFormula}: ${l.aprovados}/${l.total} aprovados (${l.taxaAprovacao}%), média ${l.mediaLikes} likes e ${l.mediaComentarios} comentários`,
    ),
  ].join("\n");
}

export const studioTool = tool(
  async ({ action, offerId, productName, category, link, commission }) => {
    try {
      if (action === "listar_ofertas") return describeOffers();
      if (action === "fila") return describeQueue();
      if (action === "desempenho") return describePerformance();

      if (action === "historico") {
        const recentes = listRecent(10);
        if (recentes.length === 0) return "Nenhum vídeo produzido ainda.";
        return recentes.map((v) => `- ${v.id.slice(0, 8)} [${v.state}] ${v.script?.hook || "sem gancho"}`).join("\n");
      }

      if (action === "criar_oferta") {
        if (!productName || !category) {
          return "Para criar uma oferta preciso de productName (o item exato que aparece no vídeo) e category.";
        }

        const offer = createOffer({ id: offerId, productName, category, link, commission });
        return `Oferta "${offer.id}" criada. Coloque os vídeos base em studio-data/base_videos/${offer.id}/ antes de produzir.`;
      }

      if (action === "minerar_ganchos") {
        if (!category) return "Informe category com o nicho a minerar, ex: 'suplemento sono'.";

        const analisados = await mineHooksForNiche(category, { analyzeLimit: 5 });

        if (analisados.length === 0) {
          return "Nenhum gancho minerado. A busca do TikTok precisa da sessão da conta de mineração — rode `npm run studio:login`.";
        }

        return [
          `${analisados.length} gancho(s) minerado(s) para "${category}":`,
          ...analisados.map((h) => `- fórmula ${h.formula} (nota ${h.gripScore}): ${h.mechanism}`),
        ].join("\n");
      }

      if (action === "ganchos") {
        const guardados = await searchMinedHooks(category || "", { limit: 8 });

        if (guardados.length === 0) return "Nenhum gancho minerado ainda. Use action='minerar_ganchos'.";

        return [
          `${countMinedHooks()} ganchos no banco. Melhores${category ? ` para "${category}"` : ""}:`,
          ...guardados.map((h) => `- [${h.niche}] fórmula ${h.formula}, nota ${h.gripScore}: ${h.mechanism}`),
        ].join("\n");
      }

      if (action === "produzir") {
        if (!offerId) return "Informe offerId. Use action='listar_ofertas' para ver os ids disponíveis.";

        const offer = getOffer(offerId);
        if (!offer) return `Oferta "${offerId}" não existe.`;

        const readiness = offerReadiness(offerId);
        if (!readiness.ready) return `Não dá para produzir agora: ${readiness.reason}`;

        const video = await produceVideoForOffer(offerId);
        return `Vídeo ${video.id.slice(0, 8)} pronto e na fila de aprovação. Gancho: "${video.script?.hook}"`;
      }

      return `Ação desconhecida: ${action}`;
    } catch (error) {
      logger.error(`studio_tool erro: ${error.message}`);
      return `Studio falhou: ${error.message}`;
    }
  },
  {
    name: "studio_tool",
    description:
      "Fábrica de conteúdo do TikTok Shop (@sodre.luxe). Use para: listar ofertas cadastradas, criar oferta nova, produzir um vídeo (roteiro + voz + render, entra na fila de aprovação do app), ver a fila aguardando aprovação, ver o histórico de vídeos, ver o desempenho por fórmula de gancho, minerar ganchos de vídeos em alta de um nicho (baixa os primeiros segundos, transcreve e classifica o mecanismo) e consultar os ganchos já minerados. Produzir gasta crédito de Gemini e ElevenLabs. A publicação no TikTok é sempre manual do Márcio — esta tool nunca publica.",
    schema: z.object({
      action: z
        .enum(["listar_ofertas", "criar_oferta", "produzir", "fila", "historico", "desempenho", "minerar_ganchos", "ganchos"])
        .describe("O que fazer no Studio"),
      offerId: z.string().optional().describe("Id da oferta, para 'produzir' ou 'criar_oferta'"),
      productName: z.string().optional().describe("Produto EXATO que aparece no vídeo, obrigatório em 'criar_oferta'"),
      category: z.string().optional().describe("Nicho/categoria, obrigatório em 'criar_oferta'"),
      link: z.string().optional().describe("Link do produto"),
      commission: z.number().optional().describe("Comissão em %"),
    }),
  },
);
