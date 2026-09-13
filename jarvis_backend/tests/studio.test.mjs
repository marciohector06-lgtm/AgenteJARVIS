import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-studio-"));

process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.STUDIO_ROOT = join(workDir, "studio-data");

const { createOffer, getOffer, listOffers, updateOffer, setOfferActive } = await import("../src/studio/offers.js");
const { narrationBudget, listBaseVideos, selectBaseVideo } = await import("../src/studio/baseVideos.js");
const { BASE_VIDEOS_DIR, ensureStudioDirs } = await import("../src/studio/paths.js");
const { db } = await import("../src/studio/db.js");

before(() => {
  ensureStudioDirs();
});

after(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("oferta sem productName é rejeitada — era o bug que abortava 100% do ciclo antigo", () => {
  assert.throws(() => createOffer({ category: "Suplementos" }), /productName/);
  assert.throws(() => createOffer({ productName: "   ", category: "Suplementos" }), /productName/);
});

test("oferta sem category é rejeitada", () => {
  assert.throws(() => createOffer({ productName: "calça jeans masculina" }), /category/);
});

test("oferta válida é persistida com hashtags normalizadas", () => {
  const offer = createOffer({
    id: "magnesio",
    productName: "Magnésio & Inositol Body Action sabor Maracujá",
    category: "Suplementos / Saúde e Bem-estar",
    link: "https://www.tiktok.com/@bodyaction",
    commission: 15,
    hashtags: ["magnesio", "#inositol", "suplemento"],
  });

  assert.equal(offer.productName, "Magnésio & Inositol Body Action sabor Maracujá");
  assert.equal(offer.commission, 15);
  assert.deepEqual(offer.hashtags, ["#magnesio", "#inositol", "#suplemento"]);
  assert.equal(offer.active, true);

  const reloaded = getOffer("magnesio");
  assert.deepEqual(reloaded.hashtags, offer.hashtags);
});

test("id duplicado é recusado", () => {
  assert.throws(() => createOffer({ id: "magnesio", productName: "outro", category: "Moda" }), /já existe/i);
});

test("updateOffer preserva campos não informados e continua exigindo productName", () => {
  const updated = updateOffer("magnesio", { commission: 20 });
  assert.equal(updated.commission, 20);
  assert.equal(updated.productName, "Magnésio & Inositol Body Action sabor Maracujá");

  assert.throws(() => updateOffer("magnesio", { productName: "" }), /productName/);
});

test("setOfferActive tira a oferta da listagem de ativas", () => {
  setOfferActive("magnesio", false);
  assert.equal(listOffers({ activeOnly: true }).length, 0);
  assert.equal(listOffers().length, 1);

  setOfferActive("magnesio", true);
  assert.equal(listOffers({ activeOnly: true }).length, 1);
});

test("budget de 24s reproduz a configuração que o magnésio usava na mão", () => {
  const budget = narrationBudget(24);
  assert.equal(budget.maxNarrationSeconds, 22);
  assert.equal(budget.charBudget, 286);
  assert.equal(budget.sceneCount, 2);
});

test("vídeo longo usa 3s de folga e 3 cenas, conforme a tabela do ROTEIRO", () => {
  const budget = narrationBudget(30);
  assert.equal(budget.maxNarrationSeconds, 27);
  assert.equal(budget.sceneCount, 3);
});

test("vídeo curto cai para 1 cena", () => {
  const budget = narrationBudget(14);
  assert.equal(budget.maxNarrationSeconds, 12);
  assert.equal(budget.sceneCount, 1);
});

test("piso de caracteres fica em 85% do teto — evita vídeo mudo no final", () => {
  const budget = narrationBudget(24);
  assert.equal(budget.minCharBudget, Math.floor(286 * 0.85));
  assert.ok(budget.minCharBudget < budget.charBudget);
});

test("duração inválida falha alto em vez de gerar budget silenciosamente errado", () => {
  assert.throws(() => narrationBudget(0), /Duração inválida/);
  assert.throws(() => narrationBudget("abc"), /Duração inválida/);
});

test("vídeos base são lidos da pasta da oferta e rotacionam de forma estável", () => {
  const offerDir = join(BASE_VIDEOS_DIR, "magnesio");
  mkdirSync(offerDir, { recursive: true });
  writeFileSync(join(offerDir, "a.mp4"), "");
  writeFileSync(join(offerDir, "b.mp4"), "");
  writeFileSync(join(offerDir, "notas.txt"), "");

  const videos = listBaseVideos("magnesio");
  assert.equal(videos.length, 2);

  assert.equal(selectBaseVideo("magnesio", 0), videos[0]);
  assert.equal(selectBaseVideo("magnesio", 1), videos[1]);
  assert.equal(selectBaseVideo("magnesio", 2), videos[0]);
  assert.equal(selectBaseVideo("magnesio", -1), videos[1]);
});

test("oferta sem vídeo base falha com instrução de onde colocar o arquivo", () => {
  assert.throws(() => selectBaseVideo("oferta-vazia"), /Coloque ao menos um arquivo/);
});

