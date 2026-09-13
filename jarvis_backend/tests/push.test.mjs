import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workDir = mkdtempSync(join(tmpdir(), "jarvis-push-"));
process.env.SQLITE_PATH = join(workDir, "test.db");

const { registerPushToken, isValidExpoToken, listPushTokens, sendPush, forgetPushToken, notifyVideoReady } =
  await import("../src/push/notifier.js");

const fetchOriginal = globalThis.fetch;
let ultimoCorpo = null;

function respondeCom(tickets) {
  ultimoCorpo = null;
  globalThis.fetch = async (_url, opts) => {
    ultimoCorpo = JSON.parse(opts.body);
    return { ok: true, status: 200, json: async () => ({ data: tickets }) };
  };
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

after(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // no Windows o handle do SQLite segura a pasta; o proprio SO limpa o temp depois
  }
});

test("token fora do formato do Expo é recusado", () => {
  assert.equal(isValidExpoToken("abc123"), false);
  assert.equal(isValidExpoToken(""), false);
  assert.equal(isValidExpoToken("ExponentPushToken[xxxxx]"), true);

  assert.throws(() => registerPushToken("token-qualquer"), /inválido/);
});

test("registrar o mesmo dispositivo duas vezes não duplica", () => {
  registerPushToken("ExponentPushToken[aaa]", "android");
  registerPushToken("ExponentPushToken[aaa]", "android");

  assert.equal(listPushTokens().filter((t) => t === "ExponentPushToken[aaa]").length, 1);
});

test("sem dispositivo registrado, não tenta enviar nada", async () => {
  forgetPushToken("ExponentPushToken[aaa]");

  let chamou = false;
  globalThis.fetch = async () => {
    chamou = true;
    return { ok: true, json: async () => ({ data: [] }) };
  };

  const r = await sendPush({ title: "x", body: "y" });

  assert.equal(r.sent, 0);
  assert.equal(chamou, false, "sem token, chamar a API do Expo é desperdício");
});

test("notificação de vídeo leva o gancho no corpo e o id nos dados", async () => {
  registerPushToken("ExponentPushToken[bbb]", "android");
  respondeCom([{ status: "ok" }]);

  const r = await notifyVideoReady({ id: "video-123", script: { hook: "Ninguém te avisa isso" } });

  assert.equal(r.sent, 1);
  assert.equal(ultimoCorpo[0].body, "Ninguém te avisa isso");
  assert.equal(ultimoCorpo[0].data.videoId, "video-123");
  assert.equal(ultimoCorpo[0].data.tipo, "studio_pending");
});

test("gancho longo é cortado para caber na notificação", async () => {
  respondeCom([{ status: "ok" }]);

  await notifyVideoReady({ id: "v", script: { hook: "a".repeat(200) } });

  assert.ok(ultimoCorpo[0].body.length <= 90);
  assert.ok(ultimoCorpo[0].body.endsWith("..."));
});

test("dispositivo desinstalado é esquecido em vez de ficar falhando pra sempre", async () => {
  registerPushToken("ExponentPushToken[ccc]", "android");
  const antes = listPushTokens().length;

  globalThis.fetch = async (_url, opts) => {
    const corpo = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: corpo.map((m) => (m.to === "ExponentPushToken[ccc]" ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" })),
      }),
    };
  };

  await sendPush({ title: "x", body: "y" });

  assert.equal(listPushTokens().length, antes - 1);
});
