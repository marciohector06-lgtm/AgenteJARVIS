import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const DEFAULT_EXTENSIONS = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".json", ".md"];
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", "logs", ".next", "coverage"]);
const MAX_CONTENT_CHARS = 30_000;

const analysisModels = MODEL_FALLBACK_CHAIN.map(
  (model) => new ChatGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY, model })
);

function walkDir(dirPath, extensions, files = []) {
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, extensions, files);
    } else if (extensions.includes(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

function collectFileContents(dirPath, extensions) {
  const files = walkDir(dirPath, extensions);
  let content = "";
  let truncated = false;

  for (const filePath of files) {
    if (content.length >= MAX_CONTENT_CHARS) {
      truncated = true;
      break;
    }

    const relativePath = path.relative(dirPath, filePath);
    const stats = statSync(filePath);
    if (stats.size > 200_000) continue;

    const fileContent = readFileSync(filePath, "utf-8");
    content += `\n--- ${relativePath} ---\n${fileContent}\n`;
  }

  return { content: content.slice(0, MAX_CONTENT_CHARS), fileCount: files.length, truncated };
}

async function analyzeCode(query, content, truncated) {
  const prompt = `Você é um engenheiro sênior analisando um código local para debug/análise.

${truncated ? "Nota: o conteúdo abaixo foi truncado por limite de tamanho, pode não incluir todos os arquivos.\n" : ""}
Pergunta do usuário: ${query}

Código:
${content}`;

  const messages = [new HumanMessage(prompt)];

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
          `local_code_rag_tool cota esgotada em "${MODEL_FALLBACK_CHAIN[i]}", trocando para "${MODEL_FALLBACK_CHAIN[i + 1]}"...`
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export const localCodeRagTool = tool(
  async ({ dirPath, query, extensions }) => {
    try {
      const { content, fileCount, truncated } = collectFileContents(
        dirPath,
        extensions?.length ? extensions.map((ext) => ext.toLowerCase()) : DEFAULT_EXTENSIONS
      );

      if (fileCount === 0) {
        return "Nenhum arquivo encontrado nesse diretório com as extensões especificadas.";
      }

      const analysis = await analyzeCode(query, content, truncated);
      logger.info(`local_code_rag_tool dirPath="${dirPath}" arquivos=${fileCount} truncado=${truncated}`);
      return analysis;
    } catch (error) {
      logger.error(`local_code_rag_tool erro: ${error.message}`);
      return `Não foi possível analisar "${dirPath}": ${error.message}`;
    }
  },
  {
    name: "local_code_rag_tool",
    description:
      "Lê recursivamente os arquivos de código de um diretório local (filtrando por extensão) e envia o conteúdo junto com uma pergunta para o Gemini analisar/debugar. Ferramenta de leitura apenas, não modifica nada.",
    schema: z.object({
      dirPath: z.string().describe("Caminho absoluto do diretório a ser analisado"),
      query: z.string().describe("Pergunta ou instrução de análise/debug sobre o código"),
      extensions: z
        .array(z.string())
        .optional()
        .describe('Extensões de arquivo a incluir, ex: [".js", ".ts"] (padrão: extensões de código comuns)'),
    }),
  }
);
