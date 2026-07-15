import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { sendToSatellite } from "../satellite/satelliteManager.js";
import { findNetworkByLocation, getSessionNetworkState } from "../satellite/knownNetworks.js";
import { getCurrentSessionId } from "../security/sessionContext.js";
import { logger } from "../logger.js";

export const satelliteDeviceControlTool = tool(
  async ({ deviceType, host, action, input, payload, location }) => {
    let resolvedLocation;
    let satelliteId;

    if (location) {
      const entry = findNetworkByLocation(location);
      if (!entry) {
        return `Não conheço nenhum local chamado "${location}". Locais conhecidos podem ser vistos com /satelites ou registrados com /registrar_local.`;
      }
      resolvedLocation = entry.location;
      satelliteId = entry.satelliteId;
    } else {
      const sessionId = getCurrentSessionId();
      const state = getSessionNetworkState(sessionId);

      if (!state || !state.matched) {
        return "Não sei em qual local você está agora — o app ainda não informou uma rede conhecida. Diga o nome do local (ex: 'a TV do estúdio') ou reconecte o app na rede certa.";
      }

      resolvedLocation = state.location;
      satelliteId = state.satelliteId;
    }

    if (!satelliteId) {
      return `Não há satélite (braço) registrado em "${resolvedLocation}" — esse equipamento não pode ser controlado remotamente daqui.`;
    }

    try {
      const response = await sendToSatellite(satelliteId, "smart_iot", { deviceType, host, action, input, payload });
      logger.info(
        `satellite_device_control_tool location="${resolvedLocation}" satelliteId=${satelliteId} deviceType=${deviceType} action=${action} status=${response.status}`
      );
      return JSON.stringify({ location: resolvedLocation, satelliteId, ...response });
    } catch (error) {
      logger.error(`satellite_device_control_tool location="${resolvedLocation}" erro=${error.message}`);
      return `Erro ao controlar o dispositivo em "${resolvedLocation}": ${error.message}`;
    }
  },
  {
    name: "satellite_device_control_tool",
    description:
      "Controla um dispositivo IoT (TV, painel LED, Broadlink/IR) num local remoto através do satélite daquele local. Use quando o usuário mencionar um lugar específico (ex: 'liga a TV da casa dos pais', 'desliga a luz do estúdio') OU quando o comando for sobre equipamento local sem IP diretamente conhecido pelo cérebro — nesse caso deixe location vazio, e o sistema usa o local ATUAL do usuário (detectado pela rede do app). Se não houver satélite no local (atual ou mencionado), a tool avisa em vez de falhar silenciosamente. Para dispositivos com IP diretamente acessível pelo cérebro, sem precisar de satélite, use smart_iot_tool em vez desta.",
    schema: z.object({
      deviceType: z.enum(["tv", "led_panel", "broadlink"]).describe("Tipo de dispositivo IoT"),
      host: z.string().describe("IP ou identificador do dispositivo dentro da rede local do satélite"),
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
      location: z
        .string()
        .optional()
        .describe("Nome do local mencionado pelo usuário (ex: 'casa dos pais', 'estúdio'). Deixe vazio para usar o local ATUAL do usuário."),
    }),
  }
);
