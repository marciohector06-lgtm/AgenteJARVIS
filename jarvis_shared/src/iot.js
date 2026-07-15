import mqtt from "mqtt";

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

export async function controlSmartIoT({ deviceType, host, action, input, payload }) {
  if (deviceType === "tv" || deviceType === "led_panel") {
    let extraPayload = {};
    if (payload) {
      try {
        extraPayload = JSON.parse(payload);
      } catch {
        throw new Error(`payload não é um JSON válido: "${payload}"`);
      }
    }
    const body = { ...(input !== undefined ? { input } : {}), ...extraPayload };
    return await controlViaRest(host, action, body);
  }

  if (deviceType === "broadlink") {
    if (!payload) {
      throw new Error("payload (comando IR em base64, como string) é obrigatório para deviceType='broadlink'.");
    }
    const topic = `broadlink/${host}/command`;
    return await publishMqtt(topic, payload);
  }

  throw new Error(`deviceType "${deviceType}" inválido.`);
}
