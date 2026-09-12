import { createServer } from "node:http";

const TEST_DEVICE_PIN = "1234";
const TEST_TOKEN = "jwt-de-teste";

const COMMAND_CATALOG = [
  { command_id: "disk_free", description: "Espaço livre no disco C.", destructive: false },
  { command_id: "restart_print_spooler", description: "Reinicia o spooler.", destructive: true },
];

function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

export function startMockBackend() {
  const requests = [];
  const sentWhatsappMessages = [];
  const executedCommands = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const body = req.method === "POST" ? await readJsonBody(req) : {};
    requests.push({ method: req.method, path: url.pathname, authorization: req.headers.authorization ?? null, body });

    const send = (status, payload) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === "/auth/token" && req.method === "POST") {
      if (body.devicePin !== TEST_DEVICE_PIN) return send(401, { error: "PIN inválido." });
      return send(200, { token: TEST_TOKEN });
    }

    if (url.pathname.startsWith("/api/v1/") && req.headers.authorization !== `Bearer ${TEST_TOKEN}`) {
      return send(401, { error: "Token ausente ou inválido." });
    }

    if (url.pathname === "/api/v1/whatsapp/status") {
      return send(200, { ready: true, me: "5561999999999" });
    }

    if (url.pathname === "/api/v1/whatsapp/messages") {
      return send(200, {
        sessionId: "5561999999999@c.us",
        limit: Number(url.searchParams.get("limit") ?? 20),
        messages: [{ role: "user", text: "e aí jarvis", timestamp: 1 }],
        aviso: "histórico do agente, não caixa de entrada",
      });
    }

    if (url.pathname === "/api/v1/whatsapp/send" && req.method === "POST") {
      if (body.confirmed !== true) {
        return send(409, { blocked: true, reason: "Comando cancelado: confirmação não recebida ou negada pelo usuário." });
      }
      sentWhatsappMessages.push(body);
      return send(200, { sent: true, to: body.to, length: String(body.message ?? "").length, truncated: false });
    }

    if (url.pathname === "/api/v1/network/clinics") {
      const clinic = url.searchParams.get("clinic");
      if (clinic && clinic !== "consultorio1") return send(404, { error: `Clínica "${clinic}" não configurada.` });
      return send(200, {
        found: true,
        clinics: [{ name: "consultorio1", host: "100.1.2.3", online: true, os: "windows", lastSeen: null, matchedBy: "tailscale_ip" }],
        total: 1,
        online: 1,
        tailscaleError: null,
      });
    }

    if (url.pathname === "/api/v1/network/commands") {
      return send(200, { commands: COMMAND_CATALOG });
    }

    if (url.pathname === "/api/v1/network/remote-command" && req.method === "POST") {
      const command = COMMAND_CATALOG.find((entry) => entry.command_id === body.command_id);
      if (!command) {
        return send(400, { error: `command_id "${body.command_id}" não está no catálogo.`, allowed: COMMAND_CATALOG.map((c) => c.command_id) });
      }
      if (command.destructive && body.confirmed !== true) {
        return send(409, { blocked: true, reason: "Comando cancelado: confirmação não recebida ou negada pelo usuário." });
      }
      executedCommands.push(body);
      return send(200, {
        clinic: body.clinic,
        host: "100.1.2.3",
        command_id: body.command_id,
        destructive: command.destructive,
        exitCode: 0,
        stdout: "simulado",
        stderr: "",
      });
    }

    if (url.pathname.startsWith("/api/v1/business/status/")) {
      const tool = url.pathname.split("/").pop();
      const known = ["meta_ads", "vercel", "supabase", "prompt_sell_tool", "tiktok_shop_tool"];
      if (!known.includes(tool)) return send(400, { error: `Integração "${tool}" desconhecida.`, allowed: known });
      return send(200, { integration: tool, tool: `${tool}_tool`, configured: false, status: "credenciais_ausentes", missing: ["FAKE_TOKEN"] });
    }

    if (url.pathname === "/api/v1/memory/search" && req.method === "POST") {
      return send(200, { query: body.query, top_k: body.top_k ?? 5, documents: ["lembrança simulada"] });
    }

    return send(404, { error: "rota inexistente no mock" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        devicePin: TEST_DEVICE_PIN,
        requests,
        sentWhatsappMessages,
        executedCommands,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
