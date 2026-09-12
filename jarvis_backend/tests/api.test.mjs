import { test } from "node:test";
import assert from "node:assert/strict";
import { getRemoteCommand, isKnownRemoteCommand, listRemoteCommands } from "../src/api/remoteCommandCatalog.js";
import { findMonitoredPc, parseMonitoredWindowsPcs } from "../src/api/monitoredPcs.js";
import { getAllowedWhatsappNumbers, isAllowedWhatsappNumber, normalizeWhatsappNumber, toWhatsappJid } from "../src/bot/whatsappAllowlist.js";
import { getBusinessToolStatus } from "../src/api/businessStatus.js";

function withEnv(values, run) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("catálogo: nenhum comando contém aspas duplas", () => {
  for (const { command_id: id } of listRemoteCommands()) {
    const command = getRemoteCommand(id);
    assert.ok(!command.powershell.includes('"'), `${id} não pode usar aspas duplas: o escape do WinRM só trata elas`);
  }
});

test("catálogo: nenhum comando contém interpolação de template JS", () => {
  for (const { command_id: id } of listRemoteCommands()) {
    assert.ok(!getRemoteCommand(id).powershell.includes("${"), `${id} não pode conter \${ }`);
  }
});

test("catálogo: a listagem não vaza o comando executável", () => {
  for (const entry of listRemoteCommands()) {
    assert.deepEqual(Object.keys(entry).sort(), ["command_id", "description", "destructive"]);
  }
});

test("catálogo: identificadores desconhecidos e poluição de protótipo são recusados", () => {
  for (const suspeito of ["rm -rf /", "__proto__", "constructor", "toString", "", null, undefined, 42, {}]) {
    assert.equal(getRemoteCommand(suspeito), null, `${String(suspeito)} não deveria resolver`);
    assert.equal(isKnownRemoteCommand(suspeito), false);
  }
});

test("catálogo: comandos de leitura não são marcados como destrutivos", () => {
  assert.equal(getRemoteCommand("disk_free").destructive, false);
  assert.equal(getRemoteCommand("uptime").destructive, false);
  assert.equal(getRemoteCommand("restart_print_spooler").destructive, true);
  assert.equal(getRemoteCommand("clear_print_queue").destructive, true);
});

test("PCs monitorados: parsing do formato nome:host", () => {
  withEnv({ MONITORED_WINDOWS_PCS: "consultorio1:100.1.2.3, consultorio2:pc-recepcao ,soNome" }, () => {
    assert.deepEqual(parseMonitoredWindowsPcs(), [
      { name: "consultorio1", host: "100.1.2.3" },
      { name: "consultorio2", host: "pc-recepcao" },
      { name: "soNome", host: "soNome" },
    ]);
  });
});

test("PCs monitorados: host com porta ou IPv6 não é truncado", () => {
  withEnv({ MONITORED_WINDOWS_PCS: "recepcao:100.1.2.3:5985" }, () => {
    assert.deepEqual(parseMonitoredWindowsPcs(), [{ name: "recepcao", host: "100.1.2.3:5985" }]);
  });
});

test("PCs monitorados: variável ausente devolve lista vazia", () => {
  withEnv({ MONITORED_WINDOWS_PCS: undefined }, () => {
    assert.deepEqual(parseMonitoredWindowsPcs(), []);
  });
});

test("PCs monitorados: busca é insensível a maiúsculas e aceita nome ou host", () => {
  withEnv({ MONITORED_WINDOWS_PCS: "Consultorio1:100.1.2.3" }, () => {
    assert.deepEqual(findMonitoredPc("consultorio1"), { name: "Consultorio1", host: "100.1.2.3" });
    assert.deepEqual(findMonitoredPc("100.1.2.3"), { name: "Consultorio1", host: "100.1.2.3" });
    assert.equal(findMonitoredPc("inexistente"), null);
    assert.equal(findMonitoredPc(""), null);
  });
});

test("allowlist de WhatsApp: normalização e montagem de JID", () => {
  assert.equal(normalizeWhatsappNumber("+55 (61) 99999-9999"), "5561999999999");
  assert.equal(toWhatsappJid("+55 61 99999-9999"), "5561999999999@c.us");
});

test("allowlist de WhatsApp: só libera números configurados", () => {
  withEnv({ ALLOWED_WHATSAPP_NUMBERS: "5561999999999,5561888888888", WHATSAPP_OWNER_NUMBER: "5561777777777" }, () => {
    assert.deepEqual(getAllowedWhatsappNumbers(), ["5561999999999", "5561888888888"]);
    assert.equal(isAllowedWhatsappNumber("5561999999999"), true);
    assert.equal(isAllowedWhatsappNumber("+55 61 99999-9999"), true);
    assert.equal(isAllowedWhatsappNumber("5561777777777"), true);
    assert.equal(isAllowedWhatsappNumber("5511000000000"), false);
    assert.equal(isAllowedWhatsappNumber(""), false);
    assert.equal(isAllowedWhatsappNumber(null), false);
  });
});

test("allowlist de WhatsApp: sem configuração nenhuma, nada é liberado", () => {
  withEnv({ ALLOWED_WHATSAPP_NUMBERS: undefined, WHATSAPP_OWNER_NUMBER: undefined }, () => {
    assert.equal(isAllowedWhatsappNumber("5561999999999"), false);
  });
});

test("status de negócio: credenciais ausentes são reportadas com honestidade", () => {
  withEnv({ VERCEL_TOKEN: undefined }, () => {
    const status = getBusinessToolStatus("vercel");
    assert.equal(status.configured, false);
    assert.equal(status.status, "credenciais_ausentes");
    assert.deepEqual(status.missing, ["VERCEL_TOKEN"]);
    assert.match(status.checked, /nenhuma chamada de rede/);
  });
});

test("status de negócio: supabase aceita qualquer um dos dois conjuntos de credenciais", () => {
  withEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined, SUPABASE_PROJECTS: '{"ShopSpy":{}}' }, () => {
    assert.equal(getBusinessToolStatus("supabase").configured, true);
  });
  withEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", SUPABASE_PROJECTS: undefined }, () => {
    assert.equal(getBusinessToolStatus("supabase").configured, true);
  });
});

test("status de negócio: integração desconhecida devolve null", () => {
  assert.equal(getBusinessToolStatus("inexistente"), null);
});
