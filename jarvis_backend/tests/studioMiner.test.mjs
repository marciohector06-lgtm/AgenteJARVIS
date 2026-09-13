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
