import { test } from "node:test";
import assert from "node:assert/strict";
import { hookNamesProduct, narrationWordCount, narrationLength } from "../src/studio/scriptWriter.js";

const oferta = {
  productName: "Magnésio & Inositol Body Action sabor Maracujá",
  category: "Suplementos / Saúde e Bem-estar",
};

test("gancho que nomeia a categoria é reprovado — foi o escorregão do primeiro vídeo real", () => {
  assert.ok(hookNamesProduct("Ninguém te avisa isso antes de comprar suplemento noturno.", oferta));
});

test("gancho que nomeia o produto é reprovado", () => {
  assert.ok(hookNamesProduct("O magnésio mudou minhas noites.", oferta));
  assert.ok(hookNamesProduct("Descobri o inositol por acaso.", oferta));
});

test("acento não engana a checagem", () => {
  assert.ok(hookNamesProduct("Tomei magnesio todo dia por um mês.", oferta));
});

test("gancho limpo passa", () => {
  assert.equal(hookNamesProduct("Eu não contava pra ninguém que fazia isso.", oferta), null);
  assert.equal(hookNamesProduct("Deitei exausto e minha mente não parava.", oferta), null);
  assert.equal(hookNamesProduct("Cheguei em casa às onze e nem tentei dormir.", oferta), null);
});

test("palavra curta ou comum não dispara falso positivo", () => {
  const outra = { productName: "kit de canetas", category: "Papelaria" };
  assert.equal(hookNamesProduct("Isso aqui mudou como eu anoto tudo.", outra), null);
});

test("contagem de palavras e de caracteres bate com o texto falado", () => {
  const script = {
    hook: "uma frase de cinco palavras",
    scenes: [{ narration: "outra frase aqui" }],
    cta: "clica embaixo",
  };

  assert.equal(narrationWordCount(script), 10);
  assert.equal(narrationLength(script), "uma frase de cinco palavras outra frase aqui clica embaixo".length);
});

test("descrição de uso no productName não vira palavra proibida", () => {
  const comDescricao = {
    productName: "Magnésio & Inositol Body Action sabor Maracujá — tomado 30 minutos antes de dormir",
    category: "Suplementos",
  };

  assert.equal(
    hookNamesProduct("Levei minutos pra perceber o que estava errado.", comDescricao),
    null,
    "palavra da descrição de uso não revela o produto"
  );
  assert.ok(hookNamesProduct("O magnésio resolveu.", comDescricao), "o nome real continua bloqueado");
});
