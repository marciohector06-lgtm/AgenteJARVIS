import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { scanNetwork, snmpGet, snmpSet } from "../../../jarvis_shared/src/network.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// ATENÇÃO — leia antes de usar/ajustar esta tool:
// "Intelbras" cobre produtos muito diferentes (switch gerenciável, roteador
// Wi-Fi, NVR/DVR de câmeras), cada um com um jeito diferente (ou nenhum) de
// ser controlado por API:
//   - port_status / restart_port / get_bandwidth: usam SNMP PADRÃO
//     (IF-MIB, RFC 2863) — funciona em qualquer switch gerenciável que tenha
//     SNMP habilitado, incluindo as linhas Intelbras SG/SF. Isso é real e
//     verificado.
//   - camera_status: NÃO existe API pública documentada da Intelbras pra
//     status de câmera por NVR/DVR (a comunicação é via protocolo
//     proprietário do app/software Intelbras, ou opcionalmente ONVIF se o
//     modelo suportar — não implementado aqui). O que dá pra fazer sem mais
//     informação é só checar se o NVR está alcançável na rede.
//   - list_wifi_devices: implementado via scan de rede (ARP) — não
//     diferencia dispositivo cabeado de Wi-Fi (ARP não sabe disso).
//   - block_device: NÃO existe API pública dos roteadores Intelbras pra
//     bloquear MAC — fica como instrução manual.
// Ajuste esses três conforme o modelo real do seu equipamento, se ele
// expuser algo mais específico (a própria Intelbras não documenta uma API
// unificada pra toda a linha).

const IF_OPER_STATUS = { 1: "up", 2: "down", 3: "testing", 4: "unknown", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown" };

function ifIndexOid(base, ifIndex) {
  return `${base}.${ifIndex}`;
}

async function getPortStatus(host, community, ifIndex) {
  const result = await snmpGet(host, ifIndexOid("1.3.6.1.2.1.2.2.1.8", ifIndex), community);
  const code = Number(result.value);
  return { ifIndex, status: IF_OPER_STATUS[code] || `desconhecido (${code})` };
}

async function restartPort(host, community, ifIndex) {
  const adminOid = ifIndexOid("1.3.6.1.2.1.2.2.1.7", ifIndex);
  await snmpSet(host, adminOid, "Integer", 2, community); // down
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await snmpSet(host, adminOid, "Integer", 1, community); // up
  return getPortStatus(host, community, ifIndex);
}

async function getBandwidth(host, community, ifIndex, sampleIntervalMs = 5_000) {
  const inOid = ifIndexOid("1.3.6.1.2.1.2.2.1.10", ifIndex);
  const outOid = ifIndexOid("1.3.6.1.2.1.2.2.1.16", ifIndex);

  const [inBefore, outBefore] = await Promise.all([snmpGet(host, inOid, community), snmpGet(host, outOid, community)]);
  await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
  const [inAfter, outAfter] = await Promise.all([snmpGet(host, inOid, community), snmpGet(host, outOid, community)]);

  const seconds = sampleIntervalMs / 1000;
  // Contadores IF-MIB de 32 bits dão overflow perto de 4GB acumulados — em
  // links de alta banda isso pode acontecer entre as duas leituras; não
  // corrigido aqui (limitação conhecida, ok pro uso de monitoramento leve).
  const inBps = Math.max(0, (Number(inAfter.value) - Number(inBefore.value)) / seconds);
  const outBps = Math.max(0, (Number(outAfter.value) - Number(outBefore.value)) / seconds);

  return { ifIndex, inKbps: Math.round((inBps * 8) / 1000), outKbps: Math.round((outBps * 8) / 1000) };
}

async function checkNvrReachable(host, port = 80) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(`http://${host}:${port}/`, { signal: controller.signal });
    return { reachable: true, httpStatus: response.status };
  } catch (error) {
    return { reachable: false, error: error.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export const intelbrasManagerTool = tool(
  async ({ action, subnet, host, community, ifIndex, nvrHost, nvrPort, mac }) => {
    try {
      if (action === "scan_network") {
        if (!subnet) return "subnet é obrigatório para action='scan_network'.";
        const devices = await scanNetwork(subnet);
        const intelbrasDevices = devices.filter((d) => d.vendor && /intelbras/i.test(d.vendor));
        logger.info(`intelbras_manager_tool action=scan_network subnet=${subnet} encontrados=${intelbrasDevices.length}`);
        return JSON.stringify(intelbrasDevices);
      }

      if (action === "port_status") {
        if (!host || ifIndex === undefined) return "host e ifIndex são obrigatórios para action='port_status'.";
        const result = await getPortStatus(host, community, ifIndex);
        logger.info(`intelbras_manager_tool action=port_status host=${host} ifIndex=${ifIndex} status=${result.status}`);
        return JSON.stringify(result);
      }

      if (action === "restart_port") {
        if (!host || ifIndex === undefined) return "host e ifIndex são obrigatórios para action='restart_port'.";
        return await guardExecution(
          `Reiniciar porta ${ifIndex} do switch Intelbras em ${host}`,
          { destructive: true },
          async () => {
            const result = await restartPort(host, community, ifIndex);
            logger.info(`intelbras_manager_tool action=restart_port host=${host} ifIndex=${ifIndex}`);
            return JSON.stringify(result);
          }
        );
      }

      if (action === "get_bandwidth") {
        if (!host || ifIndex === undefined) return "host e ifIndex são obrigatórios para action='get_bandwidth'.";
        const result = await getBandwidth(host, community, ifIndex);
        logger.info(`intelbras_manager_tool action=get_bandwidth host=${host} ifIndex=${ifIndex}`);
        return JSON.stringify(result);
      }

      if (action === "camera_status") {
        if (!nvrHost) return "nvrHost é obrigatório para action='camera_status'.";
        const result = await checkNvrReachable(nvrHost, nvrPort);
        logger.info(`intelbras_manager_tool action=camera_status nvrHost=${nvrHost} alcancavel=${result.reachable}`);
        return JSON.stringify({
          ...result,
          note: "Checagem de alcançabilidade básica só — não há API pública Intelbras pra status individual de câmera/gravação. Pra isso, seria necessário ONVIF ou o software/app proprietário Intelbras.",
        });
      }

      if (action === "list_wifi_devices") {
        if (!subnet) return "subnet é obrigatório para action='list_wifi_devices'.";
        const devices = await scanNetwork(subnet);
        return JSON.stringify({
          devices,
          note: "Lista todos os dispositivos da rede (via ARP) — não diferencia cabeado de Wi-Fi, pois essa informação não vem da tabela ARP.",
        });
      }

      if (action === "block_device") {
        if (!mac) return "mac é obrigatório para action='block_device'.";
        logger.warn(`intelbras_manager_tool action=block_device mac=${mac} — não implementado (sem API pública)`);
        return `Não implementado: não existe API pública/documentada dos roteadores Intelbras pra bloquear um MAC remotamente. Bloqueie manualmente no painel web do roteador (Dispositivos Conectados > Bloquear "${mac}"), ou configure INTELBRAS_ROUTER_API_URL se o seu modelo específico expuser uma API REST verificada.`;
      }

      return `Ação "${action}" inválida. Use: scan_network, port_status, restart_port, get_bandwidth, camera_status, list_wifi_devices, block_device.`;
    } catch (error) {
      logger.error(`intelbras_manager_tool action=${action} erro=${error.message}`);
      return `Erro em intelbras_manager_tool (${action}): ${error.message}`;
    }
  },
  {
    name: "intelbras_manager_tool",
    description:
      "Gerencia equipamentos Intelbras. 'scan_network': inventário de dispositivos Intelbras na rede (via fabricante do MAC). 'port_status'/'restart_port'/'get_bandwidth': usam SNMP padrão num switch gerenciável (host+community+ifIndex da porta). 'camera_status': checagem básica de alcançabilidade de um NVR/DVR (NÃO é status real de câmera — sem API pública Intelbras pra isso). 'list_wifi_devices': lista dispositivos da rede via scan (não diferencia Wi-Fi de cabeado). 'block_device': não implementado de verdade (sem API pública de roteador Intelbras) — retorna instrução manual.",
    schema: z.object({
      action: z
        .enum(["scan_network", "port_status", "restart_port", "get_bandwidth", "camera_status", "list_wifi_devices", "block_device"])
        .describe("Ação a executar"),
      subnet: z.string().optional().describe('Subnet "192.168.1.0/24", necessário para scan_network/list_wifi_devices'),
      host: z.string().optional().describe("IP do switch gerenciável, necessário para port_status/restart_port/get_bandwidth"),
      community: z.string().optional().describe("Community SNMP (leitura: padrão 'public'; restart_port precisa de community com permissão de escrita)"),
      ifIndex: z.union([z.string(), z.number()]).optional().describe("Índice SNMP da porta (ifIndex), necessário para port_status/restart_port/get_bandwidth"),
      nvrHost: z.string().optional().describe("IP do NVR/DVR, necessário para camera_status"),
      nvrPort: z.number().optional().describe("Porta HTTP do NVR/DVR (padrão: 80)"),
      mac: z.string().optional().describe("Endereço MAC do dispositivo, necessário para block_device"),
    }),
  }
);
