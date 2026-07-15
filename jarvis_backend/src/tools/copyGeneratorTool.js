import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const copyModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

const FORMAT_INSTRUCTIONS = {
  headline: "Gere 5 headlines curtas e impactantes de resposta direta, uma por linha.",
  ad_copy: "Gere um copy de anúncio completo de resposta direta: hook, corpo (quebra de objeções, prova), e CTA claro.",
  video_script: "Gere um roteiro curto de vídeo: hook nos primeiros 3 segundos, desenvolvimento objetivo, CTA no final.",
  email: "Gere um email de resposta direta: linha de assunto + corpo do email.",
};

async function invokeCopyModel(prompt) {
  const messages = [new HumanMessage(prompt)];

  let lastError;
  for (let i = 0; i < copyModels.length; i++) {
    try {
      const response = await copyModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === copyModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(
          `copy_generator_tool cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const copyGeneratorTool = tool(
  async ({ productType, target, tone, format }) => {
    const instruction = FORMAT_INSTRUCTIONS[format];
    if (!instruction) {
      return `Format "${format}" inválido. Use: headline, ad_copy, video_script, email.`;
    }

    const prompt = `Você é um copywriter de resposta direta de elite, especialista em conversão.

Produto/oferta: ${productType}
Público-alvo: ${target}
Tom de voz: ${tone}

${instruction}`;

    try {
      const text = await invokeCopyModel(prompt);
      logger.info(`copy_generator_tool format=${format} productType=${productType}`);
      return text;
    } catch (error) {
      logger.error(`copy_generator_tool erro: ${error.message}`);
      return `Não foi possível gerar o copy: ${error.message}`;
    }
  },
  {
    name: "copy_generator_tool",
    description:
      "Gera copy de resposta direta (headline, anúncio, roteiro de vídeo ou email) pra um produto/oferta, com público-alvo e tom de voz definidos.",
    schema: z.object({
      productType: z.string().describe("Produto ou oferta pra qual gerar o copy"),
      target: z.string().describe("Público-alvo da campanha"),
      tone: z.string().describe("Tom de voz desejado, ex: urgente, casual, premium, técnico"),
      format: z.enum(["headline", "ad_copy", "video_script", "email"]).describe("Formato do copy a gerar"),
    }),
  }
);
