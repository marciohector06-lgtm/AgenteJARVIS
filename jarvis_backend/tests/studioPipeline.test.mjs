import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-pipeline-"));

process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.STUDIO_ROOT = join(workDir, "studio-data");

const { createOffer } = await import("../src/studio/offers.js");
const pipeline = await import("../src/studio/pipeline.js");
const { db } = await import("../src/studio/db.js");

const { STATES } = pipeline;

function renderedFile(name) {
  const path = join(workDir, name);
  writeFileSync(path, "mp4");
  return path;
}

function novoVideoRenderizado() {
  const video = pipeline.createVideo({ offerId: "oferta-teste" });
  return pipeline.transition(video.id, STATES.RENDERED, {
    videoPath: renderedFile(`${video.id}.mp4`),
    script: { hook: "Ninguém te avisa isso antes de comprar", scenes: [], cta: "link aqui embaixo" },
    hookFormula: "5 (alerta de erro comum antes de comprar)",
    sceneFormat: "1 (Problema → Agitação → Solução)",
  });
}

before(() => {
  createOffer({ id: "oferta-teste", productName: "magnésio em pó", category: "Suplementos" });
});

after(() => {
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("vídeo nasce em draft e exige offerId", () => {
  assert.throws(() => pipeline.createVideo({}), /offerId/);

  const video = pipeline.createVideo({ offerId: "oferta-teste" });
  assert.equal(video.state, STATES.DRAFT);
});

test("transição inválida é recusada em vez de corromper o estado", () => {
  const video = pipeline.createVideo({ offerId: "oferta-teste" });

  assert.throws(() => pipeline.transition(video.id, STATES.APPROVED), /Transição inválida/);
  assert.throws(() => pipeline.transition(video.id, STATES.POSTED), /Transição inválida/);

  assert.equal(pipeline.getVideo(video.id).state, STATES.DRAFT, "o estado não pode ter mudado");
});

test("não dá para pedir aprovação de vídeo sem arquivo em disco", () => {
  const video = pipeline.createVideo({ offerId: "oferta-teste" });
  pipeline.transition(video.id, STATES.RENDERED, { videoPath: join(workDir, "nao-existe.mp4") });

  assert.throws(() => pipeline.submitForApproval(video.id), /não existe/);
});

test("fluxo completo: draft → rendered → aprovação → aprovado → publicado", () => {
  const video = novoVideoRenderizado();
  assert.equal(video.state, STATES.RENDERED);

  const aguardando = pipeline.submitForApproval(video.id);
  assert.equal(aguardando.state, STATES.AWAITING_APPROVAL);

  const aprovado = pipeline.recordDecision(video.id, "approve");
  assert.equal(aprovado.state, STATES.APPROVED);

  const publicado = pipeline.markPosted(video.id, "https://www.tiktok.com/@sodre.luxe/video/123");
  assert.equal(publicado.state, STATES.POSTED);
  assert.equal(publicado.postedUrl, "https://www.tiktok.com/@sodre.luxe/video/123");
});

test("a fila de aprovação sobrevive a restart — vive no banco, não em memória", async () => {
  const video = novoVideoRenderizado();
  pipeline.submitForApproval(video.id);

  const pendentesAgora = pipeline.pendingApprovals().map((v) => v.id);
  assert.ok(pendentesAgora.includes(video.id));

  const recarregado = await import(`../src/studio/pipeline.js?restart=${Date.now()}`);
  const pendentesDepois = recarregado.pendingApprovals().map((v) => v.id);

  assert.ok(
    pendentesDepois.includes(video.id),
    "o vídeo pendente sumiu após recarregar o módulo — era exatamente o bug do agente antigo",
  );
});

test("decisão grava o gancho e a fórmula usada — é o dataset que vai treinar o roteirista", () => {
  const video = novoVideoRenderizado();
  pipeline.submitForApproval(video.id);
  pipeline.recordDecision(video.id, "reject");

  const linha = db.prepare("SELECT * FROM hook_results WHERE videoId = ?").get(video.id);

  assert.equal(linha.decision, STATES.REJECTED);
  assert.equal(linha.hookText, "Ninguém te avisa isso antes de comprar");
  assert.equal(linha.hookFormula, "5 (alerta de erro comum antes de comprar)");
  assert.equal(linha.sceneFormat, "1 (Problema → Agitação → Solução)");
});

test("vídeo rejeitado pode voltar para draft e ser refeito", () => {
  const video = novoVideoRenderizado();
  pipeline.submitForApproval(video.id);
  pipeline.recordDecision(video.id, "reject");

  const refazendo = pipeline.transition(video.id, STATES.DRAFT);
  assert.equal(refazendo.state, STATES.DRAFT);
});

test("falha guarda o motivo e permite retomar do zero", () => {
  const video = pipeline.createVideo({ offerId: "oferta-teste" });

  const falhou = pipeline.markFailed(video.id, new Error("ElevenLabs respondeu 429"));
  assert.equal(falhou.state, STATES.FAILED);
  assert.match(falhou.lastError, /429/);

  const retomado = pipeline.transition(video.id, STATES.DRAFT);
  assert.equal(retomado.state, STATES.DRAFT);
  assert.equal(retomado.lastError, null, "o erro antigo não pode continuar colado no vídeo");
});

test("estado final não aceita mais transição", () => {
  const video = novoVideoRenderizado();
  pipeline.submitForApproval(video.id);
  pipeline.recordDecision(video.id, "approve");
  pipeline.markPosted(video.id, "https://www.tiktok.com/@sodre.luxe/video/999");
  pipeline.transition(video.id, STATES.MEASURED);

  assert.throws(() => pipeline.transition(video.id, STATES.DRAFT), /Transição inválida/);
});
