import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-studio-api-"));

process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.STUDIO_ROOT = join(workDir, "studio-data");
process.env.JWT_SECRET = "segredo-de-teste-nao-usado-em-producao";

const express = (await import("express")).default;
const jwt = (await import("jsonwebtoken")).default;
const { requireDeviceJwt } = await import("../src/api/requireDeviceJwt.js");
const { registerStudioRoutes } = await import("../src/api/studioRoutes.js");
const { createOffer } = await import("../src/studio/offers.js");
const pipeline = await import("../src/studio/pipeline.js");
const { VIDEO_DIR, ensureStudioDirs } = await import("../src/studio/paths.js");
const { db } = await import("../src/studio/db.js");

const token = jwt.sign({ sub: "device" }, process.env.JWT_SECRET, { expiresIn: "1h" });

let server;
let baseUrl;
let videoComArquivo;

function fakeMp4(path) {
  writeFileSync(path, Buffer.alloc(2048, 7));
  return path;
}

async function get(path, { auth = true, headers = {} } = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers },
  });
}

before(async () => {
  ensureStudioDirs();

  const router = express.Router();
  router.use(requireDeviceJwt);
  registerStudioRoutes(router);

  const app = express();
  app.use(express.json());
  app.use("/api/v1", router);

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  createOffer({ id: "oferta-api", productName: "magnésio em pó sabor maracujá", category: "Suplementos" });

  const video = pipeline.createVideo({ offerId: "oferta-api" });
  mkdirSync(VIDEO_DIR, { recursive: true });

  pipeline.transition(video.id, pipeline.STATES.RENDERED, {
    videoPath: fakeMp4(join(VIDEO_DIR, `video_${video.id}.mp4`)),
    script: { hook: "Ninguém te avisa isso antes de comprar", scenes: [], cta: "link aqui embaixo", caption: "legenda" },
    hookFormula: "5",
  });
  pipeline.submitForApproval(video.id);

  videoComArquivo = video.id;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  rmSync(workDir, { recursive: true, force: true });
});

test("sem token, a fila do Studio responde 401", async () => {
  const res = await get("/studio/pending", { auth: false });
  assert.equal(res.status, 401);
});

test("com token, a fila traz o vídeo pendente já com nome do produto", async () => {
  const res = await get("/studio/pending");
  assert.equal(res.status, 200);

  const { videos } = await res.json();
  const alvo = videos.find((v) => v.id === videoComArquivo);

  assert.ok(alvo, "o vídeo pendente deveria aparecer na fila");
  assert.equal(alvo.productName, "magnésio em pó sabor maracujá");
  assert.equal(alvo.hook, "Ninguém te avisa isso antes de comprar");
  assert.equal(alvo.hasFile, true);
});

test("o arquivo do vídeo é servido com Accept-Ranges, que é o que o player do celular usa", async () => {
  const res = await get(`/studio/video/${videoComArquivo}/file`);

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/mp4");
  assert.equal(res.headers.get("accept-ranges"), "bytes");

  const body = await res.arrayBuffer();
  assert.equal(body.byteLength, 2048);
});

test("requisição por range devolve 206 e só o pedaço pedido", async () => {
  const res = await get(`/studio/video/${videoComArquivo}/file`, { headers: { Range: "bytes=0-" } });

  assert.equal(res.status, 206);
  assert.match(res.headers.get("content-range"), /^bytes 0-\d+\/2048$/);
});

test("vídeo inexistente responde 404, não 500", async () => {
  const res = await get("/studio/video/nao-existe/file");
  assert.equal(res.status, 404);
});

test("caminho fora do diretório de vídeos é recusado com 403", async () => {
  const intruso = pipeline.createVideo({ offerId: "oferta-api" });
  pipeline.transition(intruso.id, pipeline.STATES.RENDERED, {
    videoPath: fakeMp4(join(workDir, "fora-do-diretorio.mp4")),
  });

  const res = await get(`/studio/video/${intruso.id}/file`);
  assert.equal(res.status, 403, "servir caminho arbitrário do disco seria leitura de arquivo indevida");
});

test("vídeo sem render responde 409 em vez de vazar caminho nulo", async () => {
  const semRender = pipeline.createVideo({ offerId: "oferta-api" });

  const res = await get(`/studio/video/${semRender.id}/file`);
  assert.equal(res.status, 409);
});
