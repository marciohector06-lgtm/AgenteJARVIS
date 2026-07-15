import wol from "wake_on_lan";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

export const wakeOnLanTool = tool(
  async ({ macAddress }) => {
    if (!MAC_REGEX.test(macAddress)) {
      return `Endereço MAC inválido: "${macAddress}". Use o formato XX:XX:XX:XX:XX:XX.`;
    }

    return guardExecution(`Enviar Wake-on-LAN para ${macAddress}`, { destructive: true }, () => {
      return new Promise((resolve) => {
        wol.wake(macAddress, (error) => {
          logger.info(`wake_on_lan mac=${macAddress} resultado=${error ? "erro" : "enviado"}`);
          resolve(
            error
              ? `Falha ao enviar magic packet para ${macAddress}: ${error.message}`
              : `Magic packet enviado para ${macAddress}. A máquina deve ligar em alguns segundos, se o Wake-on-LAN estiver habilitado na BIOS/placa de rede.`
          );
        });
      });
    });
  },
  {
    name: "wake_on_lan",
    description:
      "Envia um magic packet Wake-on-LAN para ligar remotamente uma máquina na rede local, dado seu endereço MAC.",
    schema: z.object({
      macAddress: z.string().describe("Endereço MAC do dispositivo, formato XX:XX:XX:XX:XX:XX"),
    }),
  }
);
