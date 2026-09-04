import { createClient } from "@supabase/supabase-js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";

// Escopo deliberadamente limitado a leituras (select) via query builder do
// client oficial — sem SQL bruto. Rodar SQL arbitrário precisaria de uma RPC
// dedicada no Supabase e aumentaria bastante a superfície de risco; não fiz
// isso por padrão. Se precisar de verdade, dá pra adicionar depois atrás de
// guardExecution.
function resolveProjectConfig(projectKey) {
  if (projectKey) {
    let projects;
    try {
      projects = JSON.parse(process.env.SUPABASE_PROJECTS || "{}");
    } catch {
      throw new Error("SUPABASE_PROJECTS no .env não é um JSON válido.");
    }

    const config = projects[projectKey];
    if (!config?.url || !config?.key) {
      throw new Error(`Projeto Supabase "${projectKey}" não encontrado em SUPABASE_PROJECTS (formato: {"nome": {"url": "...", "key": "..."}}).`);
    }
    return config;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não configurados no .env (ou informe projectKey de SUPABASE_PROJECTS).");
  }
  return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

function getClient(projectKey) {
  const { url, key } = resolveProjectConfig(projectKey);
  return createClient(url, key);
}

export const supabaseTool = tool(
  async ({ action, projectKey, table, select, filters, limit, orderBy, ascending }) => {
    try {
      const client = getClient(projectKey);

      if (action === "query") {
        if (!table) return "table é obrigatório para action='query'.";

        let query = client.from(table).select(select || "*");
        for (const filter of filters || []) {
          if (!filter.column) continue;
          query = query.eq(filter.column, filter.value);
        }
        if (orderBy) query = query.order(orderBy, { ascending: ascending !== false });
        query = query.limit(limit || 50);

        const { data, error } = await query;
        if (error) throw new Error(error.message);

        logger.info(`supabase_tool action=query table=${table} linhas=${data.length}`);
        return JSON.stringify(data);
      }

      if (action === "table_status") {
        if (!table) return "table é obrigatório para action='table_status'.";

        const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
        if (error) throw new Error(error.message);

        logger.info(`supabase_tool action=table_status table=${table} total=${count}`);
        return JSON.stringify({ table, totalRows: count });
      }

      return `Ação "${action}" inválida. Use: query, table_status.`;
    } catch (error) {
      logger.error(`supabase_tool action=${action} table=${table} erro=${error.message}`);
      return `Erro em supabase_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "supabase_tool",
    description:
      "Consulta bancos Supabase dos projetos (ShopSpy, TikTok Shop Revelado, UCB, etc — configure múltiplos projetos via SUPABASE_PROJECTS no .env como JSON, ou use SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY pra um projeto único padrão). 'query': SELECT numa tabela com filtros simples de igualdade, ordenação e limite. 'table_status': conta o total de registros de uma tabela. Só leitura — sem SQL bruto e sem escrita, por segurança.",
    schema: z.object({
      action: z.enum(["query", "table_status"]).describe("Ação a executar"),
      projectKey: z.string().optional().describe("Chave do projeto em SUPABASE_PROJECTS (ex: 'ShopSpy'). Omitido = usa SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY padrão"),
      table: z.string().describe("Nome da tabela a consultar"),
      select: z.string().optional().describe("Colunas a retornar, separadas por vírgula (padrão: '*')"),
      filters: z
        .array(z.object({ column: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }))
        .optional()
        .describe("Filtros de igualdade, ex: [{\"column\":\"status\",\"value\":\"ativo\"}]"),
      limit: z.number().optional().describe("Máximo de linhas a retornar em action='query' (padrão: 50)"),
      orderBy: z.string().optional().describe("Coluna pra ordenar o resultado de action='query'"),
      ascending: z.boolean().optional().describe("Ordem ascendente (padrão: true) quando orderBy é usado"),
    }),
  }
);
