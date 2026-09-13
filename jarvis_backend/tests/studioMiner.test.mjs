import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetricNumber, parseVideoUrl } from "../src/studio/hookMiner.js";

test("URL de vídeo entrega autor e id, absoluta ou relativa", () => {
  assert.deepEqual(parseVideoUrl("https://www.tiktok.com/@susutokshop/video/7618029041597"), {
    author: "susutokshop",
    videoId: "7618029041597",
  });
  assert.deepEqual(parseVideoUrl("/@comprinhas.vip.br/video/7672906"), {
    author: "comprinhas.vip.br",
    videoId: "7672906",
  });
});

test("handle com ponto, hífen e underscore sobrevive ao parsing", () => {
  assert.equal(parseVideoUrl("/@dicas_saude07/video/123").author, "dicas_saude07");
  assert.equal(parseVideoUrl("/@conta-teste.br/video/456").author, "conta-teste.br");
});

test("URL que não é de vídeo devolve null em vez de objeto pela metade", () => {
  assert.equal(parseVideoUrl("https://www.tiktok.com/@susutokshop"), null);
  assert.equal(parseVideoUrl("https://www.tiktok.com/explore"), null);
  assert.equal(parseVideoUrl(""), null);
});

test("sufixo K/M trata o separador como decimal, não como milhar", () => {
  assert.equal(parseMetricNumber("1.2M"), 1_200_000);
  assert.equal(parseMetricNumber("1,2M"), 1_200_000);
  assert.equal(parseMetricNumber("45.3K"), 45_300);
  assert.equal(parseMetricNumber("45,3k"), 45_300);
  assert.equal(parseMetricNumber("48.3K"), 48_300);
});

test("sem sufixo, ponto e vírgula são separadores de milhar do pt-BR", () => {
  assert.equal(parseMetricNumber("1.234"), 1234);
  assert.equal(parseMetricNumber("1.234.567"), 1_234_567);
  assert.equal(parseMetricNumber("812"), 812);
});

test('"mil" em português vale mil, não milhão, mesmo começando com m', () => {
  assert.equal(parseMetricNumber("1,5 mil"), 1500);
  assert.equal(parseMetricNumber("12 mil"), 12_000);
});

test("entrada inútil vira zero em vez de NaN", () => {
  assert.equal(parseMetricNumber(""), 0);
  assert.equal(parseMetricNumber("sem número"), 0);
  assert.equal(parseMetricNumber(undefined), 0);
});

test("número inteiro com sufixo não perde magnitude", () => {
  assert.equal(parseMetricNumber("2M"), 2_000_000);
  assert.equal(parseMetricNumber("9K"), 9_000);
});

test("legenda puramente promocional é descartada", async () => {
  const { isPurelyPromotional } = await import("../src/studio/hookMiner.js");

  assert.equal(isPurelyPromotional("Magnésio inositol em promoção aqui no Tik Tok Shop, preço imperdível"), true);
  assert.equal(isPurelyPromotional("🚨 ÚLTIMAS HORAS para aproveitar a oferta relâmpago"), true);
  assert.equal(isPurelyPromotional("#magnesio #suplemento #tiktokshopbrasil"), true);
  assert.equal(isPurelyPromotional(""), true);
});

test("legenda com conteúdo real sobrevive, mesmo citando preço uma vez", async () => {
  const { isPurelyPromotional } = await import("../src/studio/hookMiner.js");

  assert.equal(isPurelyPromotional("Se você tomar magnésio todos os dias provavelmente essas 4 coisas vão acontecer"), false);
  assert.equal(isPurelyPromotional("Quando eu vi demorei a acreditar 🤭"), false);
  assert.equal(isPurelyPromotional("Achei a qualidade altíssima! Amei! O preço me surpreendeu"), false);
});

test("conversa por curtida mede provocação, não volume absoluto", async () => {
  const { conversationRate } = await import("../src/studio/hookMiner.js");

  assert.equal(conversationRate({ likes: 100, comments: 8, shares: 2 }), 10);
  assert.equal(conversationRate({ likes: 0, comments: 50 }), 0);
  assert.equal(conversationRate({ likes: 10_000, comments: 10 }), 0.1);
});

test("nunca dividir curtidas por curtidas — o card de busca mostra likes, não views", async () => {
  const { conversationRate } = await import("../src/studio/hookMiner.js");

  const taxa = conversationRate({ likes: 2286, comments: 30, shares: 12 });
  assert.ok(taxa < 100, `taxa impossível: ${taxa}% — sinal de estar dividindo pela métrica errada`);
});

test("ranking prefere conversa alta a volume alto", async () => {
  const { rankCandidates } = await import("../src/studio/hookMiner.js");

  const ranked = rankCandidates([
    { caption: "um vídeo com bastante texto de verdade aqui", likes: 500000, conversationRate: 0.5 },
    { caption: "outro vídeo com narrativa real e contexto", likes: 4000, conversationRate: 12 },
    { caption: "promoção imperdível desconto", likes: 900000, conversationRate: 30 },
  ]);

  assert.equal(ranked.length, 2, "a legenda promocional tinha que sair, mesmo com a maior taxa");
  assert.equal(ranked[0].likes, 4000, "o de 4k likes e 12% deveria vencer o de 500k likes e 0,5%");
});
