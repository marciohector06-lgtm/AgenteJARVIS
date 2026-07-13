import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

async function routerosRequest(host, username, password, method, restPath, body) {
  const url = `http://${host}/rest${restPath}`;
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!response.ok) {
      throw new Error(
        `RouterOS respondeu HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
      );
    }

    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function findByComment(host, username, password, restPath, comment) {
  const items = await routerosRequest(host, username, password, "GET", restPath);
  return (Array.isArray(items) ? items : []).find((item) => item.comment === comment);
}

export const networkOrchestratorTool = tool(
  async ({ action, host, username, password, vlanId, ruleName, interface: iface, bandwidth }) => {
    if (!host) return "host é obrigatório.";
    if (action !== "status" && (!username || !password)) {
      return `username e password são obrigatórios para action='${action}'.`;
    }

    try {
      if (action === "status") {
        const result = await routerosRequest(host, username || "", password || "", "GET", "/system/resource");
        logger.info(`network_orchestrator_tool action=status host=${host}`);
        return JSON.stringify(result);
      }

      if (action === "vlan_create") {
        if (!vlanId || !iface) return "vlanId e interface são obrigatórios para action='vlan_create'.";
        return await guardExecution(
          `Criar VLAN ${vlanId} na interface "${iface}" em ${host}`,
          { destructive: true },
          async () => {
            const result = await routerosRequest(host, username, password, "POST", "/interface/vlan", {
              name: ruleName || `vlan${vlanId}`,
              "vlan-id": String(vlanId),
              interface: iface,
            });
            logger.info(`network_orchestrator_tool action=vlan_create host=${host} vlanId=${vlanId}`);
            return JSON.stringify(result);
          }
        );
      }

      if (action === "vlan_delete") {
        if (!vlanId) return "vlanId é obrigatório para action='vlan_delete'.";
        return await guardExecution(`Deletar VLAN ${vlanId} em ${host}`, { destructive: true }, async () => {
          const vlans = await routerosRequest(host, username, password, "GET", "/interface/vlan");
          const target = (Array.isArray(vlans) ? vlans : []).find((v) => String(v["vlan-id"]) === String(vlanId));

          if (!target) {
            return `VLAN ${vlanId} não encontrada em ${host}.`;
          }

          await routerosRequest(host, username, password, "DELETE", `/interface/vlan/${target[".id"]}`);
          logger.info(`network_orchestrator_tool action=vlan_delete host=${host} vlanId=${vlanId}`);
          return `VLAN ${vlanId} deletada com sucesso em ${host}.`;
        });
      }

      if (action === "firewall_add") {
        if (!ruleName) return "ruleName é obrigatório para action='firewall_add'.";
        return await guardExecution(
          `Adicionar regra de firewall "${ruleName}" (drop) em ${host}${iface ? `, interface="${iface}"` : ""}`,
          { destructive: true },
          async () => {
            const result = await routerosRequest(host, username, password, "POST", "/ip/firewall/filter", {
              chain: "forward",
              action: "drop",
              comment: ruleName,
              ...(iface ? { "in-interface": iface } : {}),
            });
            logger.info(`network_orchestrator_tool action=firewall_add host=${host} ruleName=${ruleName}`);
            return JSON.stringify(result);
          }
        );
      }

      if (action === "firewall_drop") {
        if (!ruleName) return "ruleName é obrigatório para action='firewall_drop'.";
        return await guardExecution(
          `Remover regra de firewall "${ruleName}" em ${host}`,
          { destructive: true },
          async () => {
            const rule = await findByComment(host, username, password, "/ip/firewall/filter", ruleName);

            if (!rule) {
              return `Regra de firewall "${ruleName}" não encontrada em ${host}.`;
            }

            await routerosRequest(host, username, password, "DELETE", `/ip/firewall/filter/${rule[".id"]}`);
            logger.info(`network_orchestrator_tool action=firewall_drop host=${host} ruleName=${ruleName}`);
            return `Regra de firewall "${ruleName}" removida com sucesso em ${host}.`;
          }
        );
      }

      if (action === "qos_set") {
        if (!iface || !bandwidth) return "interface e bandwidth são obrigatórios para action='qos_set'.";
        return await guardExecution(
          `Definir QoS em "${iface}" (${bandwidth}) em ${host}`,
          { destructive: true },
          async () => {
            const result = await routerosRequest(host, username, password, "POST", "/queue/simple", {
              name: ruleName || `qos-${iface}`,
              target: iface,
              "max-limit": bandwidth,
            });
            logger.info(`network_orchestrator_tool action=qos_set host=${host} interface=${iface} bandwidth=${bandwidth}`);
            return JSON.stringify(result);
          }
        );
      }

      return `Ação "${action}" inválida. Use: status, vlan_create, vlan_delete, firewall_add, firewall_drop, qos_set.`;
    } catch (error) {
      logger.error(`network_orchestrator_tool action=${action} host=${host} erro=${error.message}`);
      return `Erro ao executar "${action}" em ${host}: ${error.message}`;
    }
  },
  {
    name: "network_orchestrator_tool",
    description:
      "Gerencia um roteador MikroTik via API REST do RouterOS (HTTP, Basic Auth). Ações: 'status' (info do sistema), 'vlan_create'/'vlan_delete', 'firewall_add'/'firewall_drop' (regras de firewall identificadas por ruleName/comment), 'qos_set' (fila simples de QoS). Aceita host como IP local (192.168.x.x) ou Tailscale (100.x.x.x) sem distinção.",
    schema: z.object({
      action: z
        .enum(["status", "vlan_create", "vlan_delete", "firewall_add", "firewall_drop", "qos_set"])
        .describe("Ação a executar"),
      host: z.string().describe("IP do MikroTik (local 192.168.x.x ou Tailscale 100.x.x.x)"),
      username: z.string().optional().describe("Usuário RouterOS, obrigatório exceto em action='status' anônimo"),
      password: z.string().optional().describe("Senha RouterOS"),
      vlanId: z.union([z.string(), z.number()]).optional().describe("ID da VLAN, para vlan_create/vlan_delete"),
      ruleName: z
        .string()
        .optional()
        .describe("Nome/comment identificador da regra ou VLAN (usado como referência para criar/localizar)"),
      interface: z.string().optional().describe("Nome da interface física/lógica do MikroTik"),
      bandwidth: z
        .string()
        .optional()
        .describe('Limite de banda no formato RouterOS, ex: "10M/10M", necessário para qos_set'),
    }),
  }
);
