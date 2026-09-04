import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { scanNetwork } from "../../../jarvis_shared/src/network.js";
import { sendToSatellite } from "../satellite/satelliteManager.js";
import { logger } from "../logger.js";

export const networkScanTool = tool(
  async ({ subnet, satelliteId }) => {
    try {
      if (satelliteId) {
        // Delega o scan pro satélite daquele local (capacidade "network_scan",
        // adicionada em jarvis_satellite/src/index.js) — necessário porque o
        // cérebro não está fisicamente na mesma rede local que o satélite.
        const response = await sendToSatellite(satelliteId, "network_scan", { subnet });
        logger.info(`network_scan_tool satelliteId=${satelliteId} subnet=${subnet} status=${response.status}`);
        return JSON.stringify(response);
      }

      // Sem satelliteId: escaneia a rede local do próprio cérebro.
      const devices = await scanNetwork(subnet);
      logger.info(`network_scan_tool (local) subnet=${subnet} dispositivosEncontrados=${devices.length}`);
      return JSON.stringify({ status: "ok", result: devices });
    } catch (error) {
      logger.error(`network_scan_tool subnet=${subnet} erro=${error.message}`);
      return JSON.stringify({ status: "error", message: error.message });
    }
  },
  {
    name: "network_scan_tool",
    description:
      "Escaneia uma subnet /24 e retorna, pra cada dispositivo encontrado: IP, MAC, fabricante (via MAC), tipo de dispositivo (heurística por fabricante, não confiável) e um nome automático (hostname via DNS reverso ou gerado a partir do fabricante/IP). Sem satelliteId, escaneia a rede local do próprio cérebro; com satelliteId, delega o scan pro satélite daquele local (útil pra escanear redes remotas, ex: consultórios). Demora ~30-60s (faz ping sweep de 254 hosts antes de ler a tabela ARP). Não é destrutivo — só lê a rede.",
    schema: z.object({
      subnet: z.string().describe('Subnet a escanear, formato "192.168.1.0/24" (só /24 suportado)'),
      satelliteId: z
        .string()
        .optional()
        .describe("ID do satélite que deve executar o scan (rede remota). Omitido = escaneia a rede local do cérebro."),
    }),
  }
);
