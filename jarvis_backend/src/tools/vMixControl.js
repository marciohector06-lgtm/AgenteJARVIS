import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";

const VMIX_API_BASE = process.env.VMIX_API_URL || "http://127.0.0.1:8088/api/";

// Ações de alto nível pra cortes de câmera e replay, mapeadas para as funções
// reais da API HTTP do vMix (https://www.vmix.com/help26/index.htm?DeveloperAPI.html).
// "custom" preserva o comportamento original (functionName livre) pra qualquer
// outra função do vMix não coberta aqui (ex: StartRecording, SetText, Fade).
const ACTION_TO_FUNCTION = {
  cut_camera: "Cut",
  replay_start: "ReplayStartRecording",
  replay_stop: "ReplayStopRecording",
  replay_play: "ReplayPlayInput",
};

export const vMixControlTool = tool(
  async ({ action = "custom", functionName, input, value, duration }) => {
    const resolvedFunction = action === "custom" ? functionName : ACTION_TO_FUNCTION[action];

    if (!resolvedFunction) {
      return `Ação "${action}" inválida, ou functionName ausente quando action="custom".`;
    }

    const url = new URL(VMIX_API_BASE);
    url.searchParams.set("Function", resolvedFunction);
    if (input !== undefined) url.searchParams.set("Input", String(input));
    if (value !== undefined) url.searchParams.set("Value", String(value));
    if (duration !== undefined) url.searchParams.set("Duration", String(duration));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();

      logger.info(`vmix_control funcao=${resolvedFunction} httpStatus=${response.status}`);
      return response.ok
        ? `Comando "${resolvedFunction}" enviado ao vMix com sucesso.\n${text.slice(0, 500)}`
        : `vMix respondeu com erro (HTTP ${response.status}) ao comando "${resolvedFunction}".\n${text.slice(0, 500)}`;
    } catch (error) {
      logger.info(`vmix_control funcao=${resolvedFunction} erro=${error.message}`);
      return `Não foi possível conectar ao vMix em ${VMIX_API_BASE}: ${error.message}. Verifique se o vMix está aberto e o Web Controller habilitado (Settings > Web Controller).`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  {
    name: "vmix_control",
    description:
      "Controla o vMix via API HTTP local: cortes de câmera, replay e qualquer função do vMix (ex: StartRecording, StopRecording, Fade). Use action='cut_camera' com input=<número do input> pra cortar direto pra uma câmera; action='replay_start'/'replay_stop' pra controlar a gravação do replay; action='replay_play' com input=<número da câmera> pra reproduzir o replay dessa câmera. Use action='custom' (padrão) com functionName pra qualquer outra função do vMix.",
    schema: z.object({
      action: z
        .enum(["custom", "cut_camera", "replay_start", "replay_stop", "replay_play"])
        .optional()
        .describe(
          "Ação de alto nível: 'cut_camera', 'replay_start', 'replay_stop', 'replay_play', ou 'custom' (padrão) pra usar functionName livremente."
        ),
      functionName: z
        .string()
        .optional()
        .describe(
          "Nome da função do vMix, ex: StartRecording, StopRecording, Fade. Obrigatório só quando action='custom' ou omitido."
        ),
      input: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Número ou nome do Input do vMix, quando aplicável (ex: número da câmera)"),
      value: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Parâmetro Value da função, quando aplicável (ex: texto para SetText)"),
      duration: z
        .number()
        .optional()
        .describe("Duração em milissegundos, usada por exemplo em transições como Fade"),
    }),
  }
);
