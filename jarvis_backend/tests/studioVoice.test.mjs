import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-voice-"));
process.env.STUDIO_ROOT = join(workDir, "studio-data");
process.env.SQLITE_PATH = join(workDir, "test.db");
process.env.ELEVENLABS_API_KEY = "chave-de-teste";
process.env.ELEVENLABS_VOICE_ID = "voz-de-teste";

const { generateVoice } = await import("../src/studio/voice.js");

const fetchOriginal = globalThis.fetch;
let chamadas = 0;

function respondeCom(status, corpo = "erro") {
  chamadas = 0;
  globalThis.fetch = async () => {
    chamadas++;
    return { ok: false, status, text: async () => corpo, arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

after(() => rmSync(workDir, { recursive: true, force: true }));

const script = { hook: "oi", scenes: [{ narration: "teste" }], cta: "tchau" };

test("401 de permissão não é repetido — erro de chave não melhora tentando de novo", async () => {
  respondeCom(401, '{"detail":{"status":"missing_permissions"}}');

  await assert.rejects(() => generateVoice(script, "v1"), /401/);
  assert.equal(chamadas, 1, `bateu ${chamadas} vezes numa chave sem permissão`);
});

test("400 também não é repetido", async () => {
  respondeCom(400, "texto invalido");

  await assert.rejects(() => generateVoice(script, "v2"), /400/);
  assert.equal(chamadas, 1);
});

test("429 é repetido, porque limite de taxa passa", async () => {
  respondeCom(429, "rate limited");

  await assert.rejects(() => generateVoice(script, "v3"));
  assert.equal(chamadas, 4, "limite de taxa merece as 4 tentativas");
});

test("500 é repetido, porque erro de servidor é transitório", async () => {
  respondeCom(500, "boom");

  await assert.rejects(() => generateVoice(script, "v4"));
  assert.equal(chamadas, 4);
});

test("sem chave, falha na hora sem chamar a API", async () => {
  const guardada = process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  respondeCom(200);

  await assert.rejects(() => generateVoice(script, "v5"), /ELEVENLABS_API_KEY/);
  assert.equal(chamadas, 0);

  process.env.ELEVENLABS_API_KEY = guardada;
});
