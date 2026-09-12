import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockBackend } from "./mockBackend.mjs";

const serverEntryPoint = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

let backend;
let client;

function parseToolResult(result) {
  return JSON.parse(result.content[0].text);
}

before(async () => {
  backend = await startMockBackend();
  client = new Client({ name: "teste-mcp-jarvis", version: "1.0.0" }, { capabilities: {} });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [serverEntryPoint],
      env: { ...process.env, JARVIS_API_URL: backend.url, JARVIS_DEVICE_PIN: backend.devicePin },
    })
  );
});

after(async () => {
  await client?.close();
  await backend?.close();
});

test("o servidor anuncia todas as ferramentas com schema", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();

  assert.deepEqual(names, [
    "business_tool_status",
    "memory_search",
    "network_clinic_status",
    "network_list_commands",
    "network_run_remote_command",
    "whatsapp_recent_messages",
    "whatsapp_send_message",
    "whatsapp_status",
  ]);

  for (const tool of tools) {
    assert.ok(tool.description.length > 80, `${tool.name} precisa de descrição útil`);
    assert.equal(tool.inputSchema.type, "object");
  }
});

test("ferramentas destrutivas expõem o campo confirmed no schema", async () => {
  const { tools } = await client.listTools();
  for (const name of ["whatsapp_send_message", "network_run_remote_command"]) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool.inputSchema.properties.confirmed, `${name} deveria expor confirmed`);
  }
});

test("o servidor autentica no backend trocando PIN por token", async () => {
  await client.callTool({ name: "whatsapp_status", arguments: {} });
  const authCall = backend.requests.find((request) => request.path === "/auth/token");
  assert.ok(authCall, "deveria ter chamado /auth/token");
  assert.equal(authCall.body.devicePin, backend.devicePin);

  const apiCall = backend.requests.find((request) => request.path.startsWith("/api/v1/"));
  assert.match(apiCall.authorization, /^Bearer /);
});

test("leituras retornam dados estruturados", async () => {
  const status = parseToolResult(await client.callTool({ name: "whatsapp_status", arguments: {} }));
  assert.equal(status.ready, true);

  const clinics = parseToolResult(await client.callTool({ name: "network_clinic_status", arguments: {} }));
  assert.equal(clinics.total, 1);
  assert.equal(clinics.clinics[0].online, true);

  const commands = parseToolResult(await client.callTool({ name: "network_list_commands", arguments: {} }));
  assert.ok(commands.commands.some((command) => command.command_id === "restart_print_spooler"));

  const memory = parseToolResult(await client.callTool({ name: "memory_search", arguments: { query: "orçamento" } }));
  assert.equal(memory.documents.length, 1);

  const messages = parseToolResult(await client.callTool({ name: "whatsapp_recent_messages", arguments: { limit: 5 } }));
  assert.equal(messages.limit, 5);

  const business = parseToolResult(await client.callTool({ name: "business_tool_status", arguments: { tool: "vercel" } }));
  assert.equal(business.integration, "vercel");
});

test("envio de WhatsApp sem confirmação é bloqueado e nada é enviado", async () => {
  const result = await client.callTool({
    name: "whatsapp_send_message",
    arguments: { to: "5561999999999", message: "mensagem que não pode sair" },
  });

  assert.equal(result.isError, true);
  const payload = parseToolResult(result);
  assert.equal(payload.blocked, true);
  assert.match(payload.comoProsseguir, /confirmed=true/);
  assert.equal(backend.sentWhatsappMessages.length, 0, "nenhuma mensagem deveria ter sido enviada");
});

test("envio de WhatsApp com confirmação chega ao backend", async () => {
  const result = await client.callTool({
    name: "whatsapp_send_message",
    arguments: { to: "5561999999999", message: "ok", confirmed: true },
  });

  assert.notEqual(result.isError, true);
  assert.equal(parseToolResult(result).sent, true);
  assert.equal(backend.sentWhatsappMessages.length, 1);
});

test("comando remoto destrutivo sem confirmação é bloqueado", async () => {
  const result = await client.callTool({
    name: "network_run_remote_command",
    arguments: { clinic: "consultorio1", command_id: "restart_print_spooler" },
  });

  assert.equal(result.isError, true);
  assert.equal(parseToolResult(result).blocked, true);
  assert.equal(backend.executedCommands.length, 0);
});

test("comando remoto somente leitura roda sem confirmação", async () => {
  const result = await client.callTool({
    name: "network_run_remote_command",
    arguments: { clinic: "consultorio1", command_id: "disk_free" },
  });

  assert.notEqual(result.isError, true);
  assert.equal(parseToolResult(result).exitCode, 0);
});

test("command_id fora do catálogo é recusado com a lista de opções válidas", async () => {
  const result = await client.callTool({
    name: "network_run_remote_command",
    arguments: { clinic: "consultorio1", command_id: "rm -rf /", confirmed: true },
  });

  assert.equal(result.isError, true);
  assert.match(parseToolResult(result).error, /catálogo/);
});
