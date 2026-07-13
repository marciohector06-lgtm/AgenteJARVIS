import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Client } from "ssh2";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

function execViaSSH(host, username, command, { privateKeyPath, password }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => {
      conn.exec(command, (error, stream) => {
        if (error) {
          conn.end();
          return reject(error);
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("data", (data) => {
            stdout += data.toString();
          })
          .on("close", (exitCode) => {
            conn.end();
            resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
          });

        stream.stderr.on("data", (data) => {
          stderr += data.toString();
        });
      });
    });

    conn.on("error", (error) => reject(error));

    const connectConfig = { host, username, readyTimeout: 15_000 };
    if (privateKeyPath) {
      connectConfig.privateKey = readFileSync(privateKeyPath);
    } else if (password) {
      connectConfig.password = password;
    } else {
      return reject(new Error("privateKeyPath ou password é obrigatório para os='linux'."));
    }

    conn.connect(connectConfig);
  });
}

function execViaWinRM(host, username, password, command) {
  return new Promise((resolve) => {
    const escapedPassword = password.replace(/"/g, '`"');
    const escapedCommand = command.replace(/"/g, '`"');

    const script = `$securePassword = ConvertTo-SecureString "${escapedPassword}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("${username}", $securePassword)
Invoke-Command -ComputerName "${host}" -Credential $cred -ScriptBlock { ${escapedCommand} }`;

    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }));
    child.on("error", (error) => resolve({ stdout: "", stderr: error.message, exitCode: -1 }));
  });
}

export const remoteExecutionTool = tool(
  async ({ host, os, command, username, privateKeyPath, password }) => {
    if (os === "windows" && !password) {
      return "password é obrigatório para os='windows' (usado no PSCredential do WinRM).";
    }
    if (os === "linux" && !privateKeyPath && !password) {
      return "privateKeyPath ou password é obrigatório para os='linux'.";
    }

    const description = `Executar remotamente em ${host} (${os}, usuário "${username}"): ${command}`;

    return await guardExecution(description, { destructive: true }, async () => {
      const executedAt = new Date().toISOString();

      try {
        const result =
          os === "linux"
            ? await execViaSSH(host, username, command, { privateKeyPath, password })
            : await execViaWinRM(host, username, password, command);

        logger.info(`remote_execution_tool host=${host} os=${os} exitCode=${result.exitCode}`);
        return JSON.stringify({ host, os, ...result, executedAt });
      } catch (error) {
        logger.error(`remote_execution_tool host=${host} os=${os} erro=${error.message}`);
        return JSON.stringify({ host, os, error: error.message, executedAt });
      }
    });
  },
  {
    name: "remote_execution_tool",
    description:
      "Executa um comando remotamente. os='linux' usa SSH (ssh2) — funciona também contra hosts Windows com OpenSSH habilitado. os='windows' usa WinRM/PowerShell Remoting (Invoke-Command). Aceita host como IP local (192.168.x.x) ou Tailscale (100.x.x.x). Sempre passa por confirmação, pois execução remota é sempre destrutiva por natureza.",
    schema: z.object({
      host: z.string().describe("IP do host remoto (local 192.168.x.x ou Tailscale 100.x.x.x)"),
      os: z.enum(["linux", "windows"]).describe("Sistema operacional do host remoto"),
      command: z.string().describe("Comando a executar remotamente"),
      username: z.string().describe("Usuário para autenticação remota"),
      privateKeyPath: z.string().optional().describe("Caminho da chave privada SSH, alternativa a password em os='linux'"),
      password: z
        .string()
        .optional()
        .describe("Senha — obrigatória para os='windows' (WinRM), ou alternativa à chave em os='linux'"),
    }),
  }
);
