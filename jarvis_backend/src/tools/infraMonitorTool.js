import snmp from "net-snmp";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { networkPingTool } from "./networkPing.js";
import { serverStatusTool } from "./serverStatus.js";
import { wakeOnLanTool } from "./wakeOnLan.js";
import { guardExecution } from "../security/guardExecution.js";
import { logger } from "../logger.js";

function snmpGet(host, oid, community) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community || "public");

    session.get([oid], (error, varbinds) => {
      session.close();

      if (error) return reject(error);

      const varbind = varbinds[0];
      if (snmp.isVarbindError(varbind)) {
        return reject(new Error(snmp.varbindError(varbind)));
      }

      resolve({
        oid: varbind.oid,
        type: snmp.ObjectType[varbind.type] || String(varbind.type),
        value: varbind.value.toString(),
      });
    });

    session.on("error", (error) => {
      session.close();
      reject(error);
    });
  });
}

export const infraMonitorTool = tool(
  async ({ action, host, mac, oid, community }) => {
    const timestamp = new Date().toISOString();

    try {
      if (action === "ping") {
        if (!host) return "host é obrigatório para action='ping'.";
        const result = await networkPingTool.invoke({ target: host });
        return JSON.stringify({ action, host, timestamp, result });
      }

      if (action === "status") {
        if (!host) return "host é obrigatório para action='status'.";
        const url = /^https?:\/\//i.test(host) ? host : `http://${host}`;
        const result = await serverStatusTool.invoke({ url });
        return JSON.stringify({ action, host, timestamp, result });
      }

      if (action === "wol") {
        if (!mac) return "mac é obrigatório para action='wol'.";
        return await guardExecution(`Wake-on-LAN para ${mac}`, { destructive: true }, async () => {
          const result = await wakeOnLanTool.invoke({ macAddress: mac });
          logger.info(`infra_monitor_tool action=wol mac=${mac}`);
          return JSON.stringify({ action, mac, timestamp, result });
        });
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
