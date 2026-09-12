import { JarvisBackendClient } from "./backendClient.js";

export const CONFIRMATION_AWARE_TIMEOUT_MS = 130_000;

const CONFIRMED_PROPERTY = {
  type: "boolean",
  description:
    "Só envie true depois de apresentar a ação ao usuário em linguagem natural e receber aprovação explícita dele. Sem isso o hook de segurança bloqueia a chamada, e o cérebro ainda pedirá confirmação pelo aplicativo.",
} as const;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const TOOLS: ToolDefinition[] = [
  {
    name: "whatsapp_send_message",
    description:
      "Envia uma mensagem de WhatsApp de verdade pela sessão whatsapp-web.js do JARVIS. Use quando o usuário pedir explicitamente para mandar, avisar ou responder alguém no WhatsApp. O destinatário PRECISA estar na allowlist do cérebro (ALLOWED_WHATSAPP_NUMBERS ou WHATSAPP_OWNER_NUMBER) — números fora dela são recusados com 403. Só funciona com a sessão já autenticada; verifique antes com whatsapp_status se houver dúvida. Não serve para Telegram (canal legado) nem para grupos: o caminho de envio só monta JID individual. Mensagens acima de 4000 caracteres são truncadas.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Número no formato internacional, só dígitos (ex: 5561999999999).",
        },
        message: { type: "string", description: "Texto da mensagem a enviar." },
        confirmed: CONFIRMED_PROPERTY,
      },
      required: ["to", "message"],
    },
  },
  {
    name: "whatsapp_recent_messages",
    description:
      "Lê o histórico recente de CONVERSA COM O AGENTE JARVIS de um contato. ATENÇÃO — isto NÃO é a caixa de entrada do WhatsApp: o cérebro só persiste turnos que passaram pelo agente, então comandos de barra, o fluxo de CONFIRMAR/CANCELAR, mensagens de números fora da allowlist, grupos, mídia e turnos que deram erro NÃO aparecem aqui. Use para relembrar o que foi conversado, não para auditar tudo que chegou. Somente leitura.",
    inputSchema: {
      type: "object",
      properties: {
        contact: {
          type: "string",
          description: "Número do contato (só dígitos). Se omitido, usa o dono configurado em WHATSAPP_OWNER_NUMBER.",
        },
        limit: { type: "number", description: "Quantidade máxima de turnos. Padrão 20, teto 100." },
      },
    },
  },
  {
    name: "whatsapp_status",
    description:
      "Diz se a sessão do WhatsApp do JARVIS está autenticada e pronta para enviar. Use antes de um envio importante, ou quando um envio falhar, para distinguir 'sessão caiu / QR pendente' de 'número recusado pela allowlist'. Somente leitura.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "network_clinic_status",
    description:
      "Status online/offline das máquinas Windows das clínicas monitoradas pelo JARVIS via Tailscale. Use quando o usuário perguntar se uma clínica está no ar, pedir uma checagem de rede, ou citar uma clínica pelo nome. Somente leitura: não reinicia nem altera nada. O status vem do CLI 'tailscale status' rodando no cérebro; se o CLI não estiver disponível, a resposta traz o campo tailscaleError e todas as máquinas aparecem como offline — nesse caso não afirme que as clínicas caíram, relate a falha de leitura.",
    inputSchema: {
      type: "object",
      properties: {
        clinic: {
          type: "string",
          description: "Nome da clínica como configurado em MONITORED_WINDOWS_PCS. Omita para listar todas.",
        },
      },
    },
  },
  {
    name: "network_list_commands",
    description:
      "Lista o catálogo fechado de comandos de manutenção que podem ser executados nas máquinas das clínicas, com a indicação de quais alteram estado. Chame esta ferramenta ANTES de network_run_remote_command para descobrir os command_id válidos — não invente identificadores, qualquer valor fora do catálogo é recusado. Somente leitura.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "network_run_remote_command",
    description:
      "Executa um comando de manutenção PRÉ-APROVADO do catálogo numa máquina de clínica específica. Não aceita shell livre por design: apenas um command_id do catálogo (use network_list_commands para vê-los). Comandos marcados como destrutivos alteram o estado da máquina e exigem aprovação humana explícita. As credenciais de acesso vivem no cérebro e nunca são passadas por aqui. Esta chamada pode demorar até dois minutos quando o cérebro está aguardando a confirmação humana pelo aplicativo.",
    inputSchema: {
      type: "object",
      properties: {
        clinic: { type: "string", description: "Nome da clínica como em MONITORED_WINDOWS_PCS." },
        command_id: {
          type: "string",
          description: "Identificador de um comando do catálogo (ex: restart_print_spooler). Nunca um comando shell.",
        },
        confirmed: CONFIRMED_PROPERTY,
      },
      required: ["clinic", "command_id"],
    },
  },
  {
    name: "business_tool_status",
    description:
      "Verifica se uma integração de negócio do JARVIS está configurada: meta_ads, vercel, supabase, prompt_sell_tool ou tiktok_shop_tool. IMPORTANTE: a checagem é de presença de variáveis de ambiente no cérebro, sem nenhuma chamada de rede — ou seja, 'configurado' significa que a credencial existe, NÃO que ela é válida ou que o serviço está no ar. Não prometa mais do que isso ao usuário. Somente leitura, não gasta dinheiro.",
    inputSchema: {
      type: "object",
      properties: {
        tool: {
          type: "string",
          enum: ["meta_ads", "vercel", "supabase", "prompt_sell_tool", "tiktok_shop_tool"],
          description: "Qual integração checar.",
        },
      },
      required: ["tool"],
    },
  },
  {
    name: "memory_search",
    description:
      "Busca semântica na memória de longo prazo do JARVIS (ChromaDB). Use quando o usuário perguntar o que o JARVIS sabe ou lembra sobre um assunto que não está na conversa atual. Somente leitura. Cuidado ao interpretar: uma lista vazia pode significar tanto 'nada encontrado' quanto 'ChromaDB indisponível' — o cérebro degrada em silêncio nos dois casos, então a resposta traz um aviso quando vier vazia.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pergunta em linguagem natural." },
        top_k: { type: "number", description: "Quantos resultados retornar. Padrão 5, teto 20." },
      },
      required: ["query"],
    },
  },
];

function buildQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}

export async function callJarvisTool(
  client: JarvisBackendClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "whatsapp_send_message":
      return client.request(
        "/api/v1/whatsapp/send",
        { method: "POST", body: JSON.stringify(args) },
        { timeoutMs: CONFIRMATION_AWARE_TIMEOUT_MS }
      );

    case "whatsapp_recent_messages":
      return client.request(
        `/api/v1/whatsapp/messages${buildQueryString({ contact: args.contact, limit: args.limit })}`
      );

    case "whatsapp_status":
      return client.request("/api/v1/whatsapp/status");

    case "network_clinic_status":
      return client.request(`/api/v1/network/clinics${buildQueryString({ clinic: args.clinic })}`);

    case "network_list_commands":
      return client.request("/api/v1/network/commands");

    case "network_run_remote_command":
      return client.request(
        "/api/v1/network/remote-command",
        { method: "POST", body: JSON.stringify(args) },
        { timeoutMs: CONFIRMATION_AWARE_TIMEOUT_MS }
      );

    case "business_tool_status":
      return client.request(`/api/v1/business/status/${encodeURIComponent(String(args.tool ?? ""))}`);

    case "memory_search":
      return client.request("/api/v1/memory/search", { method: "POST", body: JSON.stringify(args) });

    default:
      throw new Error(`Ferramenta desconhecida: ${name}`);
  }
}
