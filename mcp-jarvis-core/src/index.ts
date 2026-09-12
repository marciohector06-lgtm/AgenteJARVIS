import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { JarvisBackendClient, JarvisBackendError, JarvisBlockedError } from "./backendClient.js";
import { callJarvisTool, TOOLS } from "./tools.js";

const backend = new JarvisBackendClient({
  baseUrl: process.env.JARVIS_API_URL,
  devicePin: process.env.JARVIS_DEVICE_PIN,
  staticToken: process.env.JARVIS_API_TOKEN,
});

const server = new Server({ name: "jarvis-core", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const result = await callJarvisTool(backend, name, (args ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    if (error instanceof JarvisBlockedError) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                blocked: true,
                reason: error.reason,
                comoProsseguir:
                  "A camada de segurança do JARVIS recusou a ação. Explique ao usuário exatamente o que seria feito, obtenha aprovação explícita dele e só então repita a chamada incluindo confirmed=true. Se o motivo citar o kill switch, nem tente de novo: o sistema está desativado de propósito.",
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const message =
      error instanceof JarvisBackendError
        ? `HTTP ${error.status}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);

    return { content: [{ type: "text", text: JSON.stringify({ error: message }, null, 2) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
