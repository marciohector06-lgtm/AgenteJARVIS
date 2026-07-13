import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const visionModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

const EXTRACTION_PROMPT = `Você está vendo uma imagem de um resultado esportivo (placar, súmula ou chaveamento de campeonato).
Extraia as informações e responda APENAS com um JSON válido, sem markdown e sem texto adicional, neste formato exato:

{
  "teams": ["Time A", "Time B"],
  "score": { "Time A": 0, "Time B": 0 },
  "stage": "fase ou chaveamento visível, ex: Quartas de final, Grupo A, Final",
  "raw_text": "qualquer texto relevante visível na imagem que não se encaixe nos campos acima"
}

Se algum campo não for identificável na imagem, use null nesse campo. Não invente dados que não estejam visíveis na imagem.`;

function extractJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function analyzeImage(imageBase64, mimeType) {
  const message = new HumanMessage({
    content: [
      { type: "text", text: EXTRACTION_PROMPT },
      { type: "image_url", image_url: `data:${mimeType};base64,${imageBase64}` },
    ],
  });

  let lastError;
  for (let i = 0; i < visionModels.length; i++) {
    try {
      const response = await visionModels[i].invoke([message]);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === visionModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `sports_data_tool cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const sportsDataTool = tool(
  async ({ imageBase64, mimeType }) => {
    try {
      const rawResponse = await analyzeImage(imageBase64, mimeType || "image/jpeg");
      const parsed = extractJson(rawResponse);
      logger.info(`sports_data_tool extraiu dados: ${JSON.stringify(parsed).slice(0, 200)}`);
      return JSON.stringify(parsed);
    } catch (error) {
      logger.error(`sports_data_tool erro: ${error.message}`);
      return JSON.stringify({
        error: `Não foi possível extrair os dados da imagem: ${error.message}`,
      });
    }
  },
  {
    name: "sports_data_tool",
    description:
      "Analisa uma imagem de resultado esportivo (placar, súmula ou chaveamento) usando visão multimodal do Gemini e retorna um JSON estruturado com times, placar, fase/chaveamento e texto bruto relevante.",
    schema: z.object({
      imageBase64: z
        .string()
        .describe("Imagem do resultado esportivo codificada em base64, sem o prefixo data:..."),
      mimeType: z
        .string()
        .optional()
        .describe("Tipo MIME da imagem, ex: image/jpeg ou image/png (padrão: image/jpeg)"),
    }),
  }
);
