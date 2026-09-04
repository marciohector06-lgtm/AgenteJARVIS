import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { remoteExecute } from "../../../jarvis_shared/src/remoteExec.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// Executa o mesmo comando PowerShell em um ou mais PCs Windows via WinRM
// (Invoke-Command remoto) ou SSH (se o PC tiver OpenSSH habilitado),
// endereçados por IP Tailscale (100.x.x.x). Roda em paralelo — cada host é
// independente, um falhar não derruba os outros.
//
// Nota sobre "tempo real": a arquitetura de tool-calling do agente só permite
// retornar UMA string final por chamada (igual toda outra tool aqui) — não dá
// pra fazer streaming token-a-token pro chat. O que este tool faz de mais
// próximo disso é logar o resultado de cada PC assim que ele termina (via
// logger.info), então acompanhando os logs do servidor dá pra ver progresso
// quase em tempo real, mesmo a resposta final da tool chegando só no fim.
export const windowsRemoteTool = tool(
  async ({ hosts, command, username, password, privateKeyPath, os }) => {
    const targetOs = os || "windows";

    if (targetOs === "windows" && !password) {
      return "password é obrigatório quando os='windows' (usado no PSCredential do WinRM).";
    }
    if (targetOs === "linux" && !privateKeyPath && !password) {
      return "privateKeyPath ou password é obrigatório quando os='linux'.";
    }

    const description = `Executar remotamente em ${hosts.length} host(s) (${targetOs}, usuário "${username}"): ${command}`;

    return guardExecution(description, { destructive: true }, async () => {
      const results = await Promise.all(
        hosts.map(async (host) => {
          const startedAt = new Date().toISOString();
          try {
            const result = await remoteExecute({ host, os: targetOs, command, username, privateKeyPath, password });
            logger.info(`windows_remote_tool host=${host} exitCode=${result.exitCode}`);
            return { host, startedAt, ...result };
          } catch (error) {
            logger.error(`windows_remote_tool host=${host} erro=${error.message}`);
            return { host, startedAt, error: error.message };
          }
        })
      );

      return JSON.stringify({ command, os: targetOs, results });
    });
  },
  {
    name: "windows_remote_tool",
    description:
      "Executa um comando PowerShell remotamente em um ou mais PCs Windows via WinRM (ou SSH, se os='linux'), endereçados por IP Tailscale (100.x.x.x) ou IP local. Roda em paralelo em todos os hosts informados e retorna stdout/stderr/exitCode de cada um. Sempre destrutivo por natureza (execução remota arbitrária) — passa por confirmação.",
    schema: z.object({
      hosts: z.array(z.string()).describe("Lista de IPs (Tailscale 100.x.x.x ou local) dos PCs alvo"),
      command: z.string().describe("Comando PowerShell a executar em cada host"),
      username: z.string().describe("Usuário para autenticação remota"),
      os: z
        .enum(["windows", "linux"])
        .optional()
        .describe("Sistema operacional dos hosts (padrão: 'windows', via WinRM)"),
      password: z
        .string()
        .optional()
        .describe("Senha — obrigatória quando os='windows' (WinRM), ou alternativa à chave em os='linux'"),
      privateKeyPath: z
        .string()
        .optional()
        .describe("Caminho da chave privada SSH, alternativa a password quando os='linux'"),
    }),
  }
);
