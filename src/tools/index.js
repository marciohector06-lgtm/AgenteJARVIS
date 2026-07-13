import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { viralTrendSearchTool } from "./viralTrendSearch.js";
import { terminalExecutorTool } from "./terminalExecutor.js";
import { systemStatusTool } from "./systemStatus.js";
import { networkPingTool } from "./networkPing.js";
import { serverStatusTool } from "./serverStatus.js";
import { tiktokProductHunterTool } from "./tiktokProductHunter.js";
import { vMixControlTool } from "./vMixControl.js";
import { logReaderTool } from "./logReader.js";
import { wakeOnLanTool } from "./wakeOnLan.js";

const getSystemTimeTool = tool(
  async () => {
    return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  },
  {
    name: "get_system_time",
    description: "Retorna a data e hora atuais reais do servidor (horário de Brasília).",
    schema: z.object({}),
  }
);

const calculatorTool = tool(
  async ({ expression }) => {
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
      return "Expressão inválida: só são aceitos números e operadores + - * / ( ).";
    }
    try {
      return String(Function(`"use strict"; return (${expression});`)());
    } catch {
      return "Não foi possível calcular essa expressão.";
    }
  },
  {
    name: "calculator",
    description:
      "Calcula o resultado de uma expressão matemática simples (ex: '12 * (3 + 4)').",
    schema: z.object({
      expression: z.string().describe("Expressão matemática a ser calculada"),
    }),
  }
);

export const tools = [
  getSystemTimeTool,
  calculatorTool,
  viralTrendSearchTool,
  terminalExecutorTool,
  systemStatusTool,
  networkPingTool,
  serverStatusTool,
  tiktokProductHunterTool,
  vMixControlTool,
  logReaderTool,
  wakeOnLanTool,
];
