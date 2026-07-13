import { exec } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";

const VALID_HOST = /^[a-zA-Z0-9.\-:]+$/;

function extractLatency(output) {
  const match =
    output.match(/(?:tempo|time)[=<]\s*([\d.]+)\s*ms/i) ||
    output.match(/(?:média|average)\s*=\s*([\d.]+)\s*ms/i) ||
    output.match(/(?:min\/avg\/max|rtt)\D+=\s*[\d.]+\/([\d.]+)\//i);
  return match ? `${match[1]}ms` : null;
}

export const networkPingTool = tool(
  async ({ target }) => {
    if (!VALID_HOST.test(target)) {
      return `Alvo inválido: "${target}". Use apenas um IP ou domínio (ex: 8.8.8.8 ou google.com).`;
    }

    const countFlag = process.platform === "win32" ? "-n" : "-c";
    const command = `ping ${countFlag} 4 ${target}`;

    const output = await new Promise((resolve) => {
      exec(command, { timeout: 15_000 }, (error, stdout, stderr) => {
        resolve({ error, text: stdout || stderr || error?.message || "" });
      });
    });

    if (output.error) {
      logger.info(`network_ping alvo=${target} status=offline`);
      return `Host "${target}" está OFFLINE ou inalcançável.\n\n${output.text}`;
    }

    const latency = extractLatency(output.text);
    logger.info(`network_ping alvo=${target} status=online latencia=${latency || "n/a"}`);
    return `Host "${target}" está ONLINE.${
      latency ? ` Latência média: ${latency}.` : ""
    }\n\n${output.text}`;
  },
  {
    name: "network_ping",
    description:
      "Faz ping em um IP ou domínio e informa se o host está online e a latência em ms.",
    schema: z.object({
      target: z.string().describe("IP ou domínio a ser testado, ex: 8.8.8.8 ou google.com"),
    }),
  }
);
