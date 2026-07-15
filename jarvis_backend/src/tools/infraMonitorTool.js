import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { pingHost, getServerStatus, wakeOnLan, snmpGet } from "../../../jarvis_shared/src/network.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

export const infraMonitorTool = tool(
  async ({ action, host, mac, oid, community }) => {
    const timestamp = new Date().toISOString();

    try {
      if (action === "ping") {
        if (!host) return "host é obrigatório para action='ping'.";
        const result = await pingHost(host);
        return JSON.stringify({ action, host, timestamp, result });
      }

      if (action === "status") {
        if (!host) return "host é obrigatório para action='status'.";
        const url = /^https?:\/\//i.test(host) ? host : `http://${host}`;
        const result = await getServerStatus(url);
        return JSON.stringify({ action, host, timestamp, result });
      }

      if (action === "wol") {
        if (!mac) return "mac é obrigatório para action='wol'.";
        const result = await guardExecution(`Enviar Wake-on-LAN para ${mac}`, { destructive: true }, () => wakeOnLan(mac));
        logger.info(`infra_monitor_tool action=wol mac=${mac}`);
        return JSON.stringify({ action, mac, timestamp, result });
      }

      if (action === "snmp_get") {
        if (!host || !oid) return "host e oid são obrigatórios para action='snmp_get'.";
        const result = await snmpGet(host, oid, community);
        logger.info(`infra_monitor_tool action=snmp_get host=${host} oid=${oid}`);
        return JSON.stringify({ action, host, timestamp, result });
      }

      return `Ação "${action}" inválida. Use: ping, status, wol, snmp_get.`;
    } catch (error) {
      logger.error(`infra_monitor_tool action=${action} erro=${error.message}`);
      return JSON.stringify({ action, host, timestamp, error: error.message });
    }
  },
  {
    name: "infra_monitor_tool",
    description:
      "Orquestra monitoramento de infraestrutura: 'ping' (chama network_ping), 'status' (chama server_status), 'wol' (chama wake_on_lan, destrutivo), 'snmp_get' (lê um OID via SNMP de equipamentos de rede/nobreaks, ex: Intelbras). Aceita host como IP local (192.168.x.x) ou Tailscale (100.x.x.x) sem distinção.",
    schema: z.object({
      action: z.enum(["ping", "status", "wol", "snmp_get"]).describe("Ação de monitoramento a executar"),
      host: z
        .string()
        .optional()
        .describe("IP (local 192.168.x.x ou Tailscale 100.x.x.x) ou hostname/URL, necessário para ping/status/snmp_get"),
      mac: z.string().optional().describe("Endereço MAC, necessário para action='wol'"),
      oid: z.string().optional().describe("OID SNMP a consultar, necessário para action='snmp_get'"),
      community: z.string().optional().describe("Community SNMP (padrão: 'public')"),
    }),
  }
);
