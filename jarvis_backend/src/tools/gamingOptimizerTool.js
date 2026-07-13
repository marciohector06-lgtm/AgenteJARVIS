import { spawn } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

const SAFE_NAME = /^[\w.\-]+$/;

const LAUNCHER_PROTOCOLS = {
  steam: "steam://open/main",
  epic: "com.epicgames.launcher://apps",
  battlenet: "battlenet://",
};

function runPowerShell(command) {
  return new Promise((resolve) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    child.on("error", (error) => resolve({ code: -1, stdout: "", stderr: error.message }));
  });
}

export const gamingOptimizerTool = tool(
  async ({ action, processName, launcher }) => {
    if (process.platform !== "win32") {
      return `gaming_optimizer_tool só funciona no Windows (plataforma atual: ${process.platform}).`;
    }

    if (action === "kill_process") {
      if (!processName) return "processName é obrigatório para action='kill_process'.";
      if (!SAFE_NAME.test(processName)) {
        return `Nome de processo inválido: "${processName}". Use apenas letras, números, ".", "_" e "-".`;
      }

      return guardExecution(
        `Encerrar processo "${processName}" (Stop-Process -Force)`,
        { destructive: true },
        async () => {
          const result = await runPowerShell(`Stop-Process -Name "${processName}" -Force`);
          logger.info(`gaming_optimizer_tool kill_process processName=${processName} exitCode=${result.code}`);
          return result.code === 0
            ? `Processo "${processName}" encerrado com sucesso.`
            : `Falha ao encerrar "${processName}": ${result.stderr || "processo pode não estar em execução."}`;
        }
      );
    }

    if (action === "clear_cache") {
      return guardExecution(
        "Limpar cache: %TEMP% e Prefetch",
        { destructive: true },
        async () => {
          const command =
            'Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue; ' +
            'Remove-Item -Path "C:\\Windows\\Prefetch\\*" -Recurse -Force -ErrorAction SilentlyContinue';
          const result = await runPowerShell(command);
          logger.info(`gaming_optimizer_tool clear_cache exitCode=${result.code}`);
          return `Limpeza de cache concluída (%TEMP% e Prefetch). ${
            result.stderr ? `Alguns itens não puderam ser removidos (provavelmente em uso ou exigem permissão de administrador): ${result.stderr.slice(0, 300)}` : ""
          }`;
        }
      );
    }

    if (action === "launch") {
      if (!launcher) return "launcher é obrigatório para action='launch'.";
      const target = LAUNCHER_PROTOCOLS[launcher.toLowerCase()] || launcher;

      return guardExecution(`Abrir launcher "${launcher}" (${target})`, { destructive: true }, async () => {
        const result = await runPowerShell(`Start-Process "${target}"`);
        logger.info(`gaming_optimizer_tool launch launcher=${launcher} target=${target} exitCode=${result.code}`);
        return result.code === 0
          ? `Launcher "${launcher}" iniciado com sucesso.`
          : `Falha ao abrir "${launcher}": ${result.stderr || "verifique se está instalado."}`;
      });
    }

    return `Ação "${action}" inválida. Use: kill_process, clear_cache, launch.`;
  },
  {
    name: "gaming_optimizer_tool",
    description:
      "Otimiza a máquina Windows local pra jogos: 'kill_process' encerra um processo pelo nome, 'clear_cache' limpa %TEMP% e Prefetch, 'launch' abre um launcher (steam, epic, battlenet, ou caminho/protocolo customizado). Só funciona no Windows.",
    schema: z.object({
      action: z.enum(["kill_process", "clear_cache", "launch"]).describe("Ação a executar"),
      processName: z
        .string()
        .optional()
        .describe("Nome do processo a encerrar (sem .exe), necessário para action='kill_process'"),
      launcher: z
        .string()
        .optional()
        .describe(
          "Launcher a abrir: 'steam', 'epic', 'battlenet', ou um caminho/protocolo customizado. Necessário para action='launch'"
        ),
    }),
  }
);
