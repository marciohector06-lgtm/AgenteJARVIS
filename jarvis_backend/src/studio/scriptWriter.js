import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const MAX_OUTPUT_TOKENS = 2048;

const scriptModels = MODEL_FALLBACK_CHAIN.map(
  (model) =>
    new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY,
      model,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    }),
);

const SYSTEM_PROMPT = `
Você é o roteirista do sistema SODRE.LUXE de UGC para TikTok Shop Brasil.
O nicho e a categoria do produto variam a cada pedido — vêm informados no prompt de cada
vídeo ("Categoria" e "PRODUTO EXATO"). Adapte tom e vocabulário ao nicho informado, nunca
assuma moda masculina por padrão.

GANCHO (HOOK) — a parte mais importante do roteiro, tem que segurar a pessoa nos
primeiros 2 segundos. Um hook fraco mata o vídeo antes da cena 1 começar.

PROIBIDO no hook (motivo: já testamos, geram scroll):
- Nomear o produto ou a categoria na primeira frase ("Jaqueta pra qualquer clima?",
  "Esse perfume é...") — isso denuncia propaganda e a pessoa passa o vídeo na hora.
- Pergunta genérica e óbvia que soa institucional ("Qual a X mais Y que existe?",
  "Você sabia que...", "Já pensou em...")
- Afirmação morna sem tensão nem curiosidade ("X transformou minha vida/rotina")
- Qualquer frase que poderia abrir o vídeo de QUALQUER produto do nicho — se o
  hook funcionaria igual pra outro produto, ele é genérico demais, refaça.
- Abstração sem imagem: todo hook tem que ter pelo menos UM detalhe concreto e
  específico (um horário, um lugar, uma parte do corpo, uma situação exata) — nunca
  só uma ideia vaga. "Isso mudou minha rotina" é fraco; "isso resolveu antes de eu
  sair de casa às 6h" é forte.

O produto só pode ser nomeado a partir da cena 1 (ou até mais tarde) — o hook cria
uma lacuna de curiosidade, tensão ou identificação ANTES de revelar do que se trata.

O prompt de cada vídeo informa qual "FÓRMULA DE GANCHO" usar nessa geração — use
EXATAMENTE essa fórmula, adaptada ao produto/categoria informado (nunca copie o
exemplo literal, ele é só ilustração do mecanismo):
1. Confissão pessoal sem nomear o item: "Eu não contava pra ninguém que fazia isso
   até semana passada."
2. Resultado/consequência mostrado antes da causa: "Foi só isso que mudou e as
   pessoas começaram a perguntar o que eu tinha feito."
3. Chamado direto a um público bem específico (não "homens", e sim uma situação
   real): "Se você trabalha em pé o dia inteiro, presta atenção nisso."
4. Afirmação contra-intuitiva ou polêmica — SEM nomear categoria, foque num hábito
   ou comportamento: "Pare de fazer isso antes de sair de casa." / "Isso que todo
   mundo faz tá errado, e eu fazia igual."
5. Alerta de erro comum — SEM nomear categoria: "Ninguém te avisa isso antes de
   comprar." / "Eu só descobri isso depois que já tinha gastado dinheiro à toa."
6. Corte no meio da ação — narração começa descrevendo uma cena/sensação física,
   não uma ideia abstrata: "Cheguei atrasado, com frio, e nem precisei trocar de roupa."

Antes de finalizar, teste o hook mentalmente: uma pessoa que não sabe o que vem a
seguir pararia de rolar o feed só com essa frase, sem saber ainda qual é o produto?
Se a resposta for "não" ou "parece anúncio", reescreva.

FORMATO DE CENAS — as cenas não são "cena 1 genérica, cena 2 genérica": elas seguem
um arco narrativo de anúncio comprovado (usado em UGC de afiliado em geral, não
inventado agora). O prompt de cada vídeo informa qual "FORMATO DE CENAS" usar —
adapte ao produto e ao número de cenas pedido, nunca copie o exemplo literal:
1. Problema → Agitação → Solução (PAS): cena 1 nomeia a dor específica do dia a dia
   e agita ela (o incômodo real, concreto); a última cena entrega o produto como
   resolução direta dessa dor exata.
2. Primeiro uso → Resultado: cena 1 é a reação/sensação no primeiro contato com o
   produto; a última cena mostra o resultado prático que isso trouxe.
3. Comparação (antes vs. agora): cena 1 descreve o jeito ruim/comum de lidar com
   a situação; a última cena mostra por que o produto muda esse cenário.
4. Prova social/recomendação: cena 1 fala como quem está recomendando pra um amigo
   específico, com um detalhe concreto; a última cena reforça com outro detalhe de
   uso real (não invente número, depoimento ou estatística).
5. Rotina integrada: cena 1 mostra o produto entrando numa rotina real (manhã,
   trabalho, treino, saída); a última cena mostra o benefício que aparece ao longo
   dessa rotina.
6. Mito vs. verdade: cena 1 desmente uma crença comum sobre a categoria do produto;
   a última cena mostra como o produto resolve o que a crença errada ignorava.
Se houver 3 cenas, a do meio é uma ponte natural entre a 1ª e a última do arco
escolhido (detalhe extra, objeção respondida, ou reforço do benefício) — não uma
cena solta fora do arco.

REGRAS FIXAS:
- PT-BR natural, sotaque neutro (paulistano/carioca suavizado)
- Tom: criador de conteúdo, não vendedor. Autêntico, direto.
- Benefício, não característica técnica
- Hook: máx 8-10 palavras, sem nomear produto/categoria (regras acima)
- CTA específico no final: sempre apontando PARA BAIXO — "clica no link ali embaixo",
  "tá no carrinho aqui embaixo", "link do produto logo abaixo". NUNCA diga "em cima",
  "aqui em cima" ou "link da bio" — o link do carrinho fica embaixo do vídeo.
- Zero escassez falsa, zero preço inventado, zero superlativos exagerados
- Proibido: "barato", "desconto", "promoção", "imperdível", "top demais"
- Duração da narração: respeite RIGOROSAMENTE a faixa de caracteres informada
  no prompt de cada vídeo ("LIMITE DE DURAÇÃO") — ela é calculada a partir do
  vídeo base real disponível, e varia a cada pedido. Ficar ABAIXO do mínimo é
  tão errado quanto passar do máximo: sobra vídeo sem narração no final, o que
  quebra a experiência (silêncio morto por cima da imagem).
- Gere EXATAMENTE o número de cenas pedido ("Número de cenas") — nunca menos.
  Cada cena precisa de narração substancial (2-3 frases), não uma frase solta.
- Quando receber "MECANISMOS DE GANCHO EM ALTA", use-os SÓ pra entender que tipo de
  tensão está funcionando nesse nicho agora — nunca copie frases, estrutura de frase
  ou hashtags. O roteiro final tem que ser 100% original, palavras suas.
- A narração TEM que falar do "PRODUTO EXATO" informado no prompt, sempre — nunca troque
  por outra peça de roupa/produto. Se o produto exato é "calça jeans", a narração fala
  de calça jeans, ponto.
- Responda APENAS com JSON válido, sem markdown, sem blocos de código

Formato de resposta (JSON puro):
{
  "hook": "gancho de abertura seguindo as fórmulas acima — máx 8-10 palavras, sem nomear produto/categoria",
  "scenes": [
    {
      "number": 1,
      "narration": "texto exato que será narrado nesta cena",
      "action": "descrição do que acontece visualmente (para referência)",
      "duration": 10
    }
  ],
  "cta": "texto do call-to-action final",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "caption": "legenda do post — máx 150 caracteres, inclui 2-3 hashtags"
}
`.trim();

export const HOOK_FORMULAS = [
  "1 (confissão pessoal sem nomear o item)",
  "2 (resultado/consequência mostrado antes da causa)",
  "3 (chamado direto a um público específico numa situação real)",
  "4 (afirmação contra-intuitiva ou polêmica)",
  "5 (alerta de erro comum antes de comprar)",
  "6 (corte no meio da ação, cena/sensação física)",
];

export const SCENE_FORMATS = [
  "1 (Problema → Agitação → Solução)",
  "2 (Primeiro uso → Resultado)",
  "3 (Comparação: antes vs. agora)",
  "4 (Prova social/recomendação pra um amigo)",
  "5 (Rotina integrada)",
  "6 (Mito vs. verdade)",
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function narrationLength(script) {
  return [script.hook, ...script.scenes.map((scene) => scene.narration), script.cta].join(" ").length;
}

function extractJson(text) {
  const raw = typeof text === "string" ? text : String(text ?? "");
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function formatMinedHooks(minedHooks) {
  if (!Array.isArray(minedHooks) || minedHooks.length === 0) return "";

  const lines = minedHooks
    .slice(0, 6)
    .map((hook) => {
      const score = Number.isFinite(hook.gripScore) ? `nota ${hook.gripScore}/10` : "sem nota";
      const formula = hook.formula ? `fórmula ${hook.formula}` : "fórmula não classificada";
      return `- [${formula} | ${score}] mecanismo: ${hook.mechanism}`;
    })
    .join("\n");

  return `
MECANISMOS DE GANCHO EM ALTA nesse nicho (minerados de vídeos reais que estão performando —
referência de MECANISMO apenas, nunca copie frase, estrutura de frase ou hashtag):
${lines}
`;
}

function buildUserPrompt({ offer, budget, hookFormula, sceneFormat, minedHooks }) {
  return `
PRODUTO EXATO que aparece no vídeo (a narração TEM que falar desse item,
nunca de outro produto): ${offer.productName}
Categoria: ${offer.category}
Comissão: ${offer.commission}%
Número de cenas: ${budget.sceneCount}
Link do produto (não falar o link, só referenciar como "ali embaixo" / "aqui embaixo"): ${offer.link}
FÓRMULA DE GANCHO obrigatória para este vídeo (ver lista no system prompt): ${hookFormula}
FORMATO DE CENAS obrigatório para este vídeo (ver lista no system prompt): ${sceneFormat}

LIMITE DE DURAÇÃO — CRÍTICO: o vídeo base disponível tem ${budget.maxNarrationSeconds}s de espaço
pra narração. Somando hook + narração de todas as cenas + CTA, o texto falado TEM
QUE FICAR ENTRE ~${budget.minCharBudget} E ~${budget.charBudget} caracteres no total (~${budget.maxNarrationSeconds}s de fala).
- Acima de ${budget.charBudget}: corta a narração no meio da fala no vídeo final.
- Abaixo de ${budget.minCharBudget}: a fala termina cedo demais e o resto do vídeo fica
  mudo/sem narração — igualmente errado, evite texto curto demais.
Escreva cenas com narração completa (2-3 frases cada) até preencher essa faixa,
nunca frases soltas de 1 linha só pra "cumprir tabela".
${formatMinedHooks(minedHooks)}
Gere o script seguindo o sistema SODRE.LUXE, com tom e vocabulário adequados ao nicho "${offer.category}".
  `.trim();
}

async function invokeScriptModel(userPrompt) {
  const messages = [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(userPrompt)];
  let lastError;

  for (let i = 0; i < scriptModels.length; i++) {
    const isLastModel = i === scriptModels.length - 1;

    try {
      const response = await scriptModels[i].invoke(messages);
      return extractJson(response.content);
    } catch (error) {
      lastError = error;
      if (isLastModel) break;

      if (isQuotaError(error)) {
        logger.warn(`studio scriptWriter: cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`);
        continue;
      }

      if (error instanceof SyntaxError) {
        logger.warn(`studio scriptWriter: "${MODEL_FALLBACK_CHAIN[i]}" devolveu JSON inválido ou truncado, trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

function assertUsableScript(script) {
  if (!script || typeof script !== "object") {
    throw new Error("O modelo não devolveu um objeto de roteiro.");
  }
  if (!script.hook || !String(script.hook).trim()) {
    throw new Error("Roteiro veio sem hook.");
  }
  if (!Array.isArray(script.scenes) || script.scenes.length === 0) {
    throw new Error("Roteiro veio sem cenas.");
  }
  if (!script.cta || !String(script.cta).trim()) {
    throw new Error("Roteiro veio sem CTA.");
  }
}

export async function generateScript({ offer, budget, minedHooks = [] }) {
  const hookFormula = pickRandom(HOOK_FORMULAS);
  const sceneFormat = pickRandom(SCENE_FORMATS);

  const userPrompt = buildUserPrompt({ offer, budget, hookFormula, sceneFormat, minedHooks });

  let script = await invokeScriptModel(userPrompt);
  assertUsableScript(script);

  let chars = narrationLength(script);
  const inRange = chars >= budget.minCharBudget && chars <= budget.charBudget;

  if (!inRange) {
    const tooShort = chars < budget.minCharBudget;
    logger.warn(
      `studio scriptWriter: narração fora da faixa (${chars} chars, alvo ${budget.minCharBudget}-${budget.charBudget}) — pedindo ajuste`,
    );

    const retryPrompt = `${userPrompt}

ATENÇÃO — SUA ÚLTIMA TENTATIVA FICOU ${tooShort ? "CURTA" : "LONGA"} DEMAIS:
gerou ${chars} caracteres de narração total, e a faixa exigida é ${budget.minCharBudget}-${budget.charBudget}.
${
  tooShort
    ? "Reescreva EXPANDINDO as cenas (mais detalhe concreto, mais frases) até entrar nessa faixa."
    : "Reescreva CORTANDO conteúdo (menos detalhe, frases mais diretas, sem perder gancho nem CTA) até entrar nessa faixa."
}`;

    const retried = await invokeScriptModel(retryPrompt);
    assertUsableScript(retried);

    const retriedChars = narrationLength(retried);
    if (Math.abs(retriedChars - budget.charBudget) < Math.abs(chars - budget.charBudget)) {
      script = retried;
      chars = retriedChars;
    }

    if (chars < budget.minCharBudget || chars > budget.charBudget) {
      logger.warn(`studio scriptWriter: ainda fora da faixa após retry (${chars} chars) — seguindo assim mesmo`);
    }
  }

  return { script, hookFormula, sceneFormat, narrationChars: chars };
}
