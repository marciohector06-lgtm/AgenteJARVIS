import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { PDFParse } from "pdf-parse";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const analysisModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

async function invokeAnalysisModel(messages) {
  let lastError;
  for (let i = 0; i < analysisModels.length; i++) {
    try {
      const response = await analysisModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === analysisModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `media_analyzer cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function analyzeImage(buffer, mimeType, caption) {
  const message = new HumanMessage({
    content: [
      {
        type: "text",
        text: caption || "Analise essa imagem e descreva o que você vê, com foco no que for relevante/acionável.",
      },
      { type: "image_url", image_url: `data:${mimeType};base64,${buffer.toString("base64")}` },
    ],
  });

  return invokeAnalysisModel([message]);
}

async function analyzePdf(buffer, caption) {
  const parser = new PDFParse({ data: buffer });
  let text;

  try {
    const result = await parser.getText();
    text = result.text;
  } finally {
    await parser.destroy();
  }

  if (!text || !text.trim()) {
    return "Não consegui extrair texto desse PDF (pode ser um PDF escaneado/sem camada de texto, ou estar vazio).";
  }

  const prompt = `${caption || "Analise o documento abaixo e resuma os pontos principais de forma objetiva."}

Conteúdo extraído do PDF:
${text.slice(0, 15000)}`;

  return invokeAnalysisModel([new HumanMessage(prompt)]);
}

export async function analyzeMedia(mediaBufferBase64, mimeType, caption) {
  const buffer = Buffer.from(mediaBufferBase64, "base64");

  if (mimeType === "application/pdf") {
    return analyzePdf(buffer, caption);
  }

  if (mimeType.startsWith("image/")) {
    return analyzeImage(buffer, mimeType, caption);
  }

  return `Tipo de mídia "${mimeType}" não suportado. Suportado: imagens (image/*) e PDF (application/pdf).`;
}
