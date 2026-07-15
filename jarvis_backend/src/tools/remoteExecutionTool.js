import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { remoteExecute } from "../../../jarvis_shared/src/remoteExec.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

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
        const result = await remoteExecute({ host, os, command, username, privateKeyPath, password });
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
