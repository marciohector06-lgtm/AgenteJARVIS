import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getServerStatus } from "../../../jarvis_shared/src/network.js";
import { logger } from "../logger.js";

export const serverStatusTool = tool(
  async ({ url }) => {
    const result = await getServerStatus(url);
    logger.info(`server_status url=${url} resultado=${result}`);
    return result;
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
