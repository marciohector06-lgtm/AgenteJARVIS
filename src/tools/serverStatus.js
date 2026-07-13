import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const serverStatusTool = tool(
  async ({ url }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, { method: "GET", signal: controller.signal });

      return response.status === 200
        ? `"${url}" está ONLINE (HTTP ${response.status}).`
        : `"${url}" respondeu, mas com status HTTP ${response.status} (${response.statusText}).`;
    } catch (error) {
      return `Não foi possível acessar "${url}": ${error.message}`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  {
    name: "server_status",
    description:
      "Verifica se uma URL pública está no ar checando o status HTTP (200 = OK).",
    schema: z.object({
      url: z.string().url().describe("URL completa a ser verificada, ex: https://exemplo.com"),
    }),
  }
);
