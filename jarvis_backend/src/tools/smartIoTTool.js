import mqtt from "mqtt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

async function controlViaRest(host, action, body) {
  const url = `http://${host}/api/${action}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
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
        `Dispositivo respondeu HTTP ${response.status}: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
      );
    }

    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

function publishMqtt(topic, message) {
  return new Promise((resolve, reject) => {
    const brokerUrl = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
    const client = mqtt.connect(brokerUrl, { connectTimeout: 8_000 });

    const timeoutId = setTimeout(() => {
      client.end(true);
      reject(new Error(`Timeout ao conectar no broker MQTT (${brokerUrl}).`));
    }, 10_000);

    client.on("connect", () => {
      client.publish(topic, message, { qos: 1 }, (error) => {
        clearTimeout(timeoutId);
        client.end();
        if (error) return reject(error);
        resolve({ topic, published: true });
      });
    });

    client.on("error", (error) => {
      clearTimeout(timeoutId);
      client.end(true);
      reject(error);
    });
  });
}

export const smartIoTTool = tool(
  async ({ deviceType, host, action, input, payload }) => {
    const description = `Controlar ${deviceType} em ${host}: ${action}`;

    return guardExecution(description, { destructive: true }, async () => {
      try {
        let result;

        if (deviceType === "tv" || deviceType === "led_panel") {
          let extraPayload = {};
          if (payload) {
            try {
              extraPayload = JSON.parse(payload);
            } catch {
              return JSON.stringify({
                deviceType,
                host,
                action,
                error: `payload não é um JSON válido: "${payload}"`,
              });
            }
          }
          const body = { ...(input !== undefined ? { input } : {}), ...extraPayload };
          result = await controlViaRest(host, action, body);
        } else if (deviceType === "broadlink") {
          if (!payload) {
            return JSON.stringify({
              deviceType,
              host,
              action,
              error: "payload (comando IR em base64, como string) é obrigatório para deviceType='broadlink'.",
            });
          }
          const topic = `broadlink/${host}/command`;
          result = await publishMqtt(topic, payload);
        } else {
          return JSON.stringify({ deviceType, host, action, error: `deviceType "${deviceType}" inválido.` });
        }

        logger.info(`smart_iot_tool deviceType=${deviceType} host=${host} action=${action}`);
        return JSON.stringify({ deviceType, host, action, result });
      } catch (error) {
        logger.error(`smart_iot_tool deviceType=${deviceType} host=${host} action=${action} erro=${error.message}`);
        return JSON.stringify({ deviceType, host, action, error: error.message });
      }
    });
  },
  {
    name: "smart_iot_tool",
    description:
      "Controla dispositivos IoT locais. deviceType='tv'/'led_panel': REST HTTP genérico best-effort (POST http://<host>/api/<action>, com input/payload livres — ajuste conforme o dispositivo real). deviceType='broadlink': publica via MQTT em broadlink/<host>/command, payload deve ser o comando IR em base64 (string). Sempre destrutivo (guardExecution).",
    schema: z.object({
      deviceType: z.enum(["tv", "led_panel", "broadlink"]).describe("Tipo de dispositivo IoT"),
      host: z.string().describe("IP ou identificador do dispositivo (local 192.168.x.x ou Tailscale 100.x.x.x)"),
      action: z.string().describe("Ação a executar, ex: power, set_input, volume, brightness, color"),
      input: z
        .union([z.string(), z.number()])
        .optional()
        .describe("Valor simples da ação, quando aplicável (ex: input da TV, nível de volume/brilho)"),
      payload: z
        .string()
        .optional()
        .describe(
          "Pra tv/led_panel: string JSON com parâmetros extras (ex: '{\"color\":\"#FF0000\"}'). Pra broadlink: string obrigatória com o comando IR em base64."
        ),
    }),
  }
);
