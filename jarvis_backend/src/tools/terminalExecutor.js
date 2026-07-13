import { exec } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution, isDestructiveCommand } from "../security/guardExecution.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOG_FILE = path.join(PROJECT_ROOT, "terminal.log");

async function logExecution(command, output) {
  const entry = `[${new Date().toISOString()}] $ ${command}\n${output}\n---\n`;
  await appendFile(LOG_FILE, entry).catch(() => {});
}

export const terminalExecutorTool = tool(
  async ({ command }) => {
    return guardExecution(
      command,
      { destructive: isDestructiveCommand(command) },
      async () => {
        const output = await new Promise((resolve) => {
          exec(
            command,
            { cwd: PROJECT_ROOT, timeout: 120_000, maxBuffer: 5 * 1024 * 1024 },
            (error, stdout, stderr) => {
              resolve(error ? `STDERR:\n${stderr || error.message}` : `STDOUT:\n${stdout}`);
            }
          );
        });

        await logExecution(command, output);
        logger.info(
          `terminal_executor comando="${command}" resultado=${output.startsWith("STDERR:") ? "erro" : "ok"}`
        );
        return output;
      }
    );
  },
  {
    name: "terminal_executor",
    description:
      "Executa um comando no terminal do sistema (ex: testes automatizados como Cypress/Playwright, ferramentas de rede como Nmap/ping) a partir do diretório do projeto. Retorna stdout em caso de sucesso ou stderr em caso de erro, para análise. Todo comando executado é registrado em terminal.log.",
    schema: z.object({
      command: z.string().describe("Comando de terminal a ser executado"),
    }),
  }
);
