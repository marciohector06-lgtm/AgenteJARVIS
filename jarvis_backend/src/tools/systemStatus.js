import os from "node:os";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function getCpuUsage() {
  return new Promise((resolve) => {
    const start = os.cpus();
    setTimeout(() => {
      const end = os.cpus();
      let idleDiff = 0;
      let totalDiff = 0;

      for (let i = 0; i < start.length; i++) {
        const startTotal = Object.values(start[i].times).reduce((a, b) => a + b, 0);
        const endTotal = Object.values(end[i].times).reduce((a, b) => a + b, 0);
        totalDiff += endTotal - startTotal;
        idleDiff += end[i].times.idle - start[i].times.idle;
      }

      resolve((100 - (idleDiff / totalDiff) * 100).toFixed(1));
    }, 200);
  });
}

export const systemStatusTool = tool(
  async () => {
    const freeMemPercent = ((os.freemem() / os.totalmem()) * 100).toFixed(1);
    const cpuUsage = await getCpuUsage();
    const uptime = formatUptime(os.uptime());

    return `RAM livre: ${freeMemPercent}%\nUso de CPU: ${cpuUsage}%\nUptime do sistema: ${uptime}`;
  },
  {
    name: "system_status",
    description:
      "Retorna o status atual do sistema: porcentagem de RAM livre, uso de CPU e uptime, em formato legível.",
    schema: z.object({}),
  }
);
