import { tool } from "@langchain/core/tools";
import { z } from "zod";

const VMIX_API_BASE = process.env.VMIX_API_URL || "http://127.0.0.1:8088/api/";

export const vMixControlTool = tool(
  async ({ functionName, input, value, duration }) => {
    const url = new URL(VMIX_API_BASE);
    url.searchParams.set("Function", functionName);
    if (input !== undefined) url.searchParams.set("Input", String(input));
    if (value !== undefined) url.searchParams.set("Value", String(value));
    if (duration !== undefined) url.searchParams.set("Duration", String(duration));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const text = await response.text();

      return response.ok
        ? `Comando "${functionName}" enviado ao vMix com sucesso.\n${text.slice(0, 500)}`
        : `vMix respondeu com erro (HTTP ${response.status}) ao comando "${functionName}".\n${text.slice(0, 500)}`;
    } catch (error) {
      return `Não foi possível conectar ao vMix em ${VMIX_API_BASE}: ${error.message}. Verifique se o vMix está aberto e o Web Controller habilitado (Settings > Web Controller).`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  {
    name: "vmix_control",
    description:
      "Controla o vMix via API HTTP local (ex: StartRecording, StopRecording, Fade, CutDirect). Recebe o nome da função do vMix e parâmetros opcionais comuns (Input, Value, Duration).",
    schema: z.object({
      functionName: z
        .string()
        .describe("Nome da função do vMix, ex: StartRecording, StopRecording, Fade, CutDirect"),
      input: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Número ou nome do Input do vMix, quando aplicável"),
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
