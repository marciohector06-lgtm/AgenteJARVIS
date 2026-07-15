import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { controlSmartIoT } from "../../../jarvis_shared/src/iot.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

export const smartIoTTool = tool(
  async ({ deviceType, host, action, input, payload }) => {
    const description = `Controlar ${deviceType} em ${host}: ${action}`;

    return guardExecution(description, { destructive: true }, async () => {
      try {
        const result = await controlSmartIoT({ deviceType, host, action, input, payload });
        logger.info(`smart_iot_tool deviceType=${deviceType} host=${host} action=${action}`);
        return JSON.stringify({ deviceType, host, action, result });
      } catch (error) {
        logger.error(`smart_iot_tool deviceType=${deviceType} host=${host} action=${action} erro=${error.message}`);
        return JSON.stringify({ deviceType, host, action, error: error.message });
      }
    });
  },
  {
    name: "smart_iot_tool",
    description:
      "Controla dispositivos IoT locais. deviceType='tv'/'led_panel': REST HTTP genérico best-effort (POST http://<host>/api/<action>, com input/payload livres — ajuste conforme o dispositivo real). deviceType='broadlink': publica via MQTT em broadlink/<host>/command, payload deve ser o comando IR em base64 (string). Sempre destrutivo (guardExecution).",
    schema: z.object({
      deviceType: z.enum(["tv", "led_panel", "broadlink"]).describe("Tipo de dispositivo IoT"),
      host: z.string().describe("IP ou identificador do dispositivo (local 192.168.x.x ou Tailscale 100.x.x.x)"),
      action: z.string().describe("Ação a executar, ex: power, set_input, volume, brightness, color"),
      input: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Valor simples da ação, quando aplicável (ex: input da TV, nível de volume/brilho)"),
      payload: z
        .string()
        .optional()
        .describe(
          "Pra tv/led_panel: string JSON com parâmetros extras (ex: '{\"color\":\"#FF0000\"}'). Pra broadlink: string obrigatória com o comando IR em base64."
        ),
    }),
  }
);
