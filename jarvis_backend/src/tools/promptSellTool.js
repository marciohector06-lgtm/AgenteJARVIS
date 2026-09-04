import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

// Regras reais do PROMPT SELL MASTER (substituindo a inferência anterior):
// - produto "simple": 3 cenas (hook + demonstração + CTA)
// - produto "kit": 4 cenas (hook + unboxing + demonstração + CTA)
// - cor definida: mantida em TODAS as cenas, independente de simple/kit
//   (por isso "colored" deixou de ser um productType à parte — cor é um
//   atributo que se aplica a qualquer um dos dois tipos)
// - HOOK sempre com 3 opções alternativas pra escolher
// - PRESENTER padrão: mulher jovem 25-30 anos, cabelo escuro, ambiente
//   limpo e minimalista (pode ser sobrescrito via presenterOverride)
// - B-ROLL: no máximo 1 cena sem presenter (só produto) no vídeo inteiro
// - Entrega dual-format: JSON PT-BR (briefing por cena) + prompt EN
//   cinematográfico em prosa fluida — SEM listar ações em tópicos, porque
//   lista de ações gera movimento robótico na geração de vídeo (Veo 3)

const sellModels = MODEL_FALLBACK_CHAIN.map((model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model }));

const DEFAULT_PRESENTER = "mulher jovem, 25-30 anos, cabelo escuro, em ambiente limpo e minimalista";

const SCENE_STRUCTURE = {
  simple: ["hook", "demonstracao", "cta"],
  kit: ["hook", "unboxing", "demonstracao", "cta"],
};

const PROMPT_TEMPLATE = `Você é um especialista em roteiros UGC (User Generated Content) pra anúncios de resposta direta, seguindo o padrão PROMPT SELL MASTER. Siga estas regras à risca:

1. ESTRUTURA DE CENAS: __SCENE_COUNT__ cenas no total: __SCENE_LIST__.
2. HOOK: gere 3 opções DIFERENTES de hook (variações do mesmo slot inicial, não 3 cenas extras) — a pessoa escolhe uma depois.
3. COR: __COLOR_RULE__
4. PRESENTER (aparece em todas as cenas exceto a de b-roll, se houver): __PRESENTER__.
5. B-ROLL: no máximo 1 das cenas (fora o hook) pode ser só produto, sem o presenter aparecer. As demais cenas têm presenter.
6. O prompt cinematográfico em inglês (campo prompt_veo3_en) deve ser um parágrafo em PROSA CORRIDA e FLUIDA, descrevendo movimento humano natural e contínuo. NUNCA liste ações em tópicos/sequência numerada dentro desse prompt — isso gera movimento robótico e cortado na geração de vídeo. Descreva como uma cena acontecendo, não como uma lista de instruções.

Produto: __PRODUCT_NAME__
Tipo: __PRODUCT_TYPE_LABEL__

Responda APENAS com um JSON válido (sem markdown, sem texto adicional), neste formato exato:
{
  "hook_opcoes": [
    { "texto_ptbr": "...", "possui_presenter": true, "duracao_segundos": 3 },
    { "texto_ptbr": "...", "possui_presenter": true, "duracao_segundos": 3 },
    { "texto_ptbr": "...", "possui_presenter": true, "duracao_segundos": 3 }
  ],
  "cenas_seguintes": [
    { "tipo": "unboxing_ou_demonstracao_ou_cta", "acao_ptbr": "...", "fala_sugerida": "...", "possui_presenter": true, "duracao_segundos": 5 }
  ],
  "cor_do_produto": __COLOR_JSON_VALUE__,
  "prompt_veo3_en": "um único parágrafo em inglês, prosa fluida, sem listas"
}

"cenas_seguintes" deve conter exatamente as cenas __SCENE_LIST_NO_HOOK__ nessa ordem, uma depois da outra.`;

const PRODUCT_TYPE_LABEL = { simple: "Produto simples", kit: "Kit (múltiplos itens)" };

function buildPrompt(productName, productType, color, presenterOverride) {
  const allScenes = SCENE_STRUCTURE[productType];
  const scenesWithoutHook = allScenes.filter((s) => s !== "hook");

  const colorRule = color
    ? `A cor do produto é "${color}" — mantenha essa cor visível e consistente em TODAS as cenas (hook e demais).`
    : "Produto sem cor específica definida — não é necessário fixar uma cor.";

  return PROMPT_TEMPLATE.replace("__SCENE_COUNT__", String(allScenes.length))
    .replace("__SCENE_LIST__", allScenes.join(" + "))
    .replace("__SCENE_LIST_NO_HOOK__", scenesWithoutHook.join(", "))
    .replace("__COLOR_RULE__", colorRule)
    .replace("__COLOR_JSON_VALUE__", color ? `"${color}"` : "null")
    .replace("__PRESENTER__", presenterOverride || DEFAULT_PRESENTER)
    .replace("__PRODUCT_NAME__", productName)
    .replace("__PRODUCT_TYPE_LABEL__", PRODUCT_TYPE_LABEL[productType]);
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

// Validação leve do que o modelo devolveu contra as regras reais — não força
// nada (o modelo pode errar), só loga um aviso pra facilitar detectar
// quando o Gemini não seguiu a estrutura pedida.
function validateAgainstRules(parsed, productType) {
  const problems = [];
  const expectedFollowUpCount = SCENE_STRUCTURE[productType].length - 1;

  if (!Array.isArray(parsed.hook_opcoes) || parsed.hook_opcoes.length !== 3) {
    problems.push(`hook_opcoes deveria ter 3 itens, veio ${parsed.hook_opcoes?.length ?? 0}`);
  }
  if (!Array.isArray(parsed.cenas_seguintes) || parsed.cenas_seguintes.length !== expectedFollowUpCount) {
    problems.push(`cenas_seguintes deveria ter ${expectedFollowUpCount} itens, veio ${parsed.cenas_seguintes?.length ?? 0}`);
  }

  const allScenes = [...(parsed.hook_opcoes || []), ...(parsed.cenas_seguintes || [])];
  const brollCount = allScenes.filter((s) => s.possui_presenter === false).length;
  if (brollCount > 1) {
    problems.push(`b-roll sem presenter apareceu em ${brollCount} cena(s), regra permite no máximo 1`);
  }

  if (problems.length > 0) {
    logger.warn(`prompt_sell_tool: saída do modelo fugiu das regras: ${problems.join("; ")}`);
  }
}

async function invokeSellModel(prompt) {
  const messages = [new HumanMessage(prompt)];
  let lastError;

  for (let i = 0; i < sellModels.length; i++) {
    try {
      const response = await sellModels[i].invoke(messages);
      return response.content;
    } catch (error) {
      lastError = error;
      const isLastModel = i === sellModels.length - 1;
      if (isQuotaError(error) && !isLastModel) {
        logger.warn(`prompt_sell_tool cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const promptSellTool = tool(
  async ({ productName, productType, color, presenterOverride }) => {
    try {
      const prompt = buildPrompt(productName, productType, color, presenterOverride);
      const raw = await invokeSellModel(prompt);
      const parsed = extractJson(raw);
      validateAgainstRules(parsed, productType);
      logger.info(`prompt_sell_tool productName="${productName}" productType=${productType} cor=${color || "nenhuma"}`);
      return JSON.stringify(parsed);
    } catch (error) {
      logger.error(`prompt_sell_tool erro: ${error.message}`);
      return `Não foi possível gerar a cena: ${error.message}`;
    }
  },
  {
    name: "prompt_sell_tool",
    description:
      "Gera uma cena de anúncio UGC no padrão PROMPT SELL MASTER. productType='simple': 3 cenas (hook+demonstração+CTA). productType='kit': 4 cenas (hook+unboxing+demonstração+CTA). O hook sempre vem com 3 opções alternativas. Se color for informado, a cor é mantida em todas as cenas (funciona com qualquer productType). No máximo 1 cena do vídeo pode ser b-roll (produto sem presenter). Retorna JSON PT-BR com o briefing por cena + um prompt cinematográfico em inglês (prosa fluida, sem lista de ações) pronto pro Veo 3.",
    schema: z.object({
      productName: z.string().describe("Nome do produto ou oferta"),
      productType: z.enum(["simple", "kit"]).describe("'simple' (3 cenas) ou 'kit' (4 cenas, com unboxing)"),
      color: z.string().optional().describe("Cor específica do produto, mantida em todas as cenas. Omitido = sem cor fixa."),
      presenterOverride: z
        .string()
        .optional()
        .describe("Descrição alternativa do presenter, substituindo o padrão (mulher jovem 25-30, cabelo escuro, ambiente minimalista)"),
    }),
  }
);
