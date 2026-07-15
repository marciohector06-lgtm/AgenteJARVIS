import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { pingHost } from "../../../jarvis_shared/src/network.js";
import { logger } from "../logger.js";

export const networkPingTool = tool(
  async ({ target }) => {
    try {
      const result = await pingHost(target);
      logger.info(`network_ping alvo=${target} resultado=${result.includes("ONLINE") ? "online" : "offline"}`);
      return result;
    } catch (error) {
      return error.message;
    }
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
