import { spawn } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { pingHost } from "../../../jarvis_shared/src/network.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// Usa o CLI "tailscale" instalado localmente no cérebro (assume que o
// próprio jarvis_backend roda numa máquina já na tailnet, já que é ele quem
// recebe heartbeat dos satélites via Tailscale). "tailscale status --json"
// é um comando real e documentado do cliente Tailscale — não depende de API
// token nenhum, só do cliente estar instalado e logado.
function runTailscaleCli(args) {
  return new Promise((resolve) => {
    const child = spawn("tailscale", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (error) => resolve({ code: -1, stdout: "", stderr: error.message }));
  });
}

async function listDevices() {
  const { code, stdout, stderr } = await runTailscaleCli(["status", "--json"]);

  if (code !== 0) {
    throw new Error(`"tailscale status" falhou (código ${code}): ${stderr || "verifique se o Tailscale está instalado e logado nesta máquina."}`);
  }

  const status = JSON.parse(stdout);
  const devices = [];

  if (status.Self) {
    devices.push({
      hostname: status.Self.HostName,
      tailscaleIPs: status.Self.TailscaleIPs,
      os: status.Self.OS,
      online: true,
      self: true,
      lastSeen: null,
    });
  }

  for (const peer of Object.values(status.Peer || {})) {
    devices.push({
      hostname: peer.HostName,
      tailscaleIPs: peer.TailscaleIPs,
      os: peer.OS,
      online: Boolean(peer.Online),
      self: false,
      lastSeen: peer.LastSeen || null,
    });
  }

  return devices;
}

async function pingDevice(target) {
  const result = await pingHost(target);
  return result;
}

// Gera o script de instalação silenciosa. Se TAILSCALE_API_KEY e
// TAILSCALE_TAILNET estiverem configurados, cria uma authkey de verdade via
// API REST oficial do Tailscale (POST /api/v2/tailnet/{tailnet}/keys,
// documentado em tailscale.com/api) e já embute no script. Sem essas envs,
// devolve o script com um placeholder pro usuário colar a authkey manual
// (gerada no admin console: login.tailscale.com/admin/settings/keys).
async function createAuthKey() {
  const apiKey = process.env.TAILSCALE_API_KEY;
  const tailnet = process.env.TAILSCALE_TAILNET;

  if (!apiKey || !tailnet) return null;

  const response = await fetch(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/keys`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      capabilities: { devices: { create: { reusable: false, ephemeral: false, preauthorized: true } } },
      expirySeconds: 3600,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tailscale API respondeu HTTP ${response.status} ao gerar authkey.`);
  }

  const payload = await response.json();
  return payload.key;
}

function buildInstallScript(authKey, hostname) {
  return `# Instalação silenciosa do Tailscale (gerado por tailscale_manager_tool)
winget install --id tailscale.tailscale -e --silent --accept-package-agreements --accept-source-agreements
Start-Sleep -Seconds 5
tailscale up --authkey=${authKey || "<SEU_AUTH_KEY_AQUI>"} --hostname=${hostname || "<NOME_DO_PC>"} --accept-routes
tailscale status
`;
}

export const tailscaleManagerTool = tool(
  async ({ action, target, hostname }) => {
    try {
      if (action === "list_devices") {
        const devices = await listDevices();
        logger.info(`tailscale_manager_tool action=list_devices total=${devices.length}`);
        return JSON.stringify(devices);
      }

      if (action === "ping") {
        if (!target) return "target é obrigatório para action='ping'.";
        const result = await pingDevice(target);
        logger.info(`tailscale_manager_tool action=ping target=${target}`);
        return result;
      }

      if (action === "generate_install_script") {
        return guardExecution(
          "Gerar script de instalação silenciosa do Tailscale" +
            (process.env.TAILSCALE_API_KEY ? " (com authkey real gerada via API)" : " (com placeholder de authkey)"),
          { destructive: Boolean(process.env.TAILSCALE_API_KEY && process.env.TAILSCALE_TAILNET) },
          async () => {
            const authKey = await createAuthKey().catch((error) => {
              logger.error(`tailscale_manager_tool: falha ao gerar authkey via API: ${error.message}`);
              return null;
            });
            const script = buildInstallScript(authKey, hostname);
            logger.info(`tailscale_manager_tool action=generate_install_script authKeyGerada=${Boolean(authKey)}`);
            return script;
          }
        );
      }

      return `Ação "${action}" inválida. Use: list_devices, ping, generate_install_script.`;
    } catch (error) {
      logger.error(`tailscale_manager_tool action=${action} erro=${error.message}`);
      return `Erro em tailscale_manager_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "tailscale_manager_tool",
    description:
      "Gerencia a malha Tailscale. 'list_devices': lista todos os dispositivos (online/offline, IPs, SO) via 'tailscale status --json' local. 'ping': ping + latência num dispositivo específico pelo IP/hostname Tailscale. 'generate_install_script': gera um script PowerShell de instalação silenciosa do Tailscale pra um novo PC — se TAILSCALE_API_KEY e TAILSCALE_TAILNET estiverem configurados, gera uma authkey real via API; senão, o script vem com um placeholder pra colar a authkey manual do admin console.",
    schema: z.object({
      action: z.enum(["list_devices", "ping", "generate_install_script"]).describe("Ação a executar"),
      target: z.string().optional().describe("IP ou hostname Tailscale do dispositivo, necessário para action='ping'"),
      hostname: z
        .string()
        .optional()
        .describe("Nome a dar ao novo dispositivo no script de instalação, usado só em action='generate_install_script'"),
    }),
  }
);
