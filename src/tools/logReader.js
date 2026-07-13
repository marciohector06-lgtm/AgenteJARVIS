import { open } from "node:fs/promises";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const CHUNK_SIZE = 64 * 1024;

async function readLastLines(filePath, lineCount) {
  const fileHandle = await open(filePath, "r");

  try {
    const { size } = await fileHandle.stat();
    let position = size;
    let data = "";
    let lines = [];

    while (position > 0 && lines.length <= lineCount) {
      const readSize = Math.min(CHUNK_SIZE, position);
      position -= readSize;

      const buffer = Buffer.alloc(readSize);
      await fileHandle.read(buffer, 0, readSize, position);
      data = buffer.toString("utf-8") + data;
      lines = data.split("\n");
    }

    return lines.slice(-lineCount).join("\n");
  } finally {
    await fileHandle.close();
  }
}

export const logReaderTool = tool(
  async ({ filePath, lineCount }) => {
    try {
      const content = await readLastLines(filePath, lineCount || 50);
      return content.trim()
        ? `Últimas ${lineCount || 50} linhas de "${filePath}":\n\n${content}`
        : `O arquivo "${filePath}" está vazio.`;
    } catch (error) {
      return `Não foi possível ler "${filePath}": ${error.message}`;
    }
  },
  {
    name: "log_reader",
    description:
      "Lê apenas as últimas linhas de um arquivo de log, sem carregar o arquivo inteiro na memória. Útil para depurar arquivos grandes.",
    schema: z.object({
      filePath: z.string().describe("Caminho completo do arquivo de log"),
      lineCount: z
        .number()
        .optional()
        .describe("Quantidade de linhas finais a retornar (padrão: 50)"),
    }),
  }
);
