import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import winston from "winston";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

const CYPRESS_BIN = path.join(
  "node_modules",
  ".bin",
  process.platform === "win32" ? "cypress.cmd" : "cypress"
);

function createRunLogger(logFile) {
  return winston.createLogger({
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, message }) => `[${timestamp}] ${message}`)
    ),
    transports: [new winston.transports.File({ filename: logFile })],
  });
}

function runCypressInBackground(projectPath, specPattern, cypressBinPath, logFile) {
  const runLogger = createRunLogger(logFile);
  const args = ["run"];
  if (specPattern) args.push("--spec", specPattern);

  const child = spawn(cypressBinPath, args, { cwd: projectPath, shell: true });

  child.stdout.on("data", (data) => runLogger.info(data.toString().trimEnd()));
  child.stderr.on("data", (data) => runLogger.info(`STDERR: ${data.toString().trimEnd()}`));
  child.on("close", (code) => {
    runLogger.info(`Processo Cypress encerrado (exit code ${code})`);
    logger.info(`qa_engineer_tool cypress finalizado pid=${child.pid} exitCode=${code}`);
  });
  child.on("error", (error) => {
    runLogger.info(`Erro ao rodar Cypress: ${error.message}`);
    logger.error(`qa_engineer_tool erro ao spawnar cypress: ${error.message}`);
  });

  return child.pid;
}

export const qaEngineerTool = tool(
  async ({ projectPath, specPattern }) => {
    if (!existsSync(projectPath)) {
      return JSON.stringify({ status: "error", message: `Diretório "${projectPath}" não existe.` });
    }

    const cypressBinPath = path.join(projectPath, CYPRESS_BIN);
    if (!existsSync(cypressBinPath)) {
      return JSON.stringify({
        status: "error",
        message: `Cypress não encontrado em "${cypressBinPath}". Rode "npm install cypress" no projeto antes de usar esta tool.`,
      });
    }

    const description = `Rodar Cypress em background: projectPath="${projectPath}"${
      specPattern ? `, spec="${specPattern}"` : ""
    }`;

    return guardExecution(description, { destructive: true }, async () => {
      const logFile = path.join(projectPath, `cypress-run-${Date.now()}.log`);
      const pid = runCypressInBackground(projectPath, specPattern, cypressBinPath, logFile);

      logger.info(`qa_engineer_tool iniciado pid=${pid} projectPath="${projectPath}" logFile="${logFile}"`);

      return JSON.stringify({ status: "started", pid, logFile });
    });
  },
  {
    name: "qa_engineer_tool",
    description:
      "Roda testes automatizados Cypress em background (não bloqueia a conversa) para um projeto local. Retorna imediatamente { status, pid, logFile } enquanto o Cypress roda em segundo plano; use log_reader no logFile retornado para acompanhar o progresso.",
    schema: z.object({
      projectPath: z.string().describe("Caminho absoluto do projeto onde rodar o Cypress"),
      specPattern: z
        .string()
        .optional()
        .describe("Padrão de spec do Cypress a rodar, ex: cypress/e2e/login.cy.js (opcional, roda todos se omitido)"),
    }),
  }
);
