const DEFAULT_BRIDGE_PORT = 4010;
const BRIDGE_TIMEOUT_MS = 20000;

function resolveBridgeUrl() {
  if (process.env.WHATSAPP_BRIDGE_URL) return process.env.WHATSAPP_BRIDGE_URL.replace(/\/+$/, "");
  return `http://127.0.0.1:${process.env.WHATSAPP_BRIDGE_PORT || DEFAULT_BRIDGE_PORT}`;
}

async function callBridge(path, init = {}) {
  const token = process.env.WHATSAPP_BRIDGE_TOKEN;

  if (!token) {
    return {
      ok: false,
      status: 503,
      body: {
        error:
          "WHATSAPP_BRIDGE_TOKEN não configurado. A ponte com o processo jarvis-whatsapp está desligada, então operações de WhatsApp estão indisponíveis.",
      },
    };
  }

  try {
    const response = await fetch(`${resolveBridgeUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Bridge-Token": token, ...(init.headers || {}) },
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });

    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 503,
      body: {
        error: `Não foi possível falar com o processo jarvis-whatsapp em ${resolveBridgeUrl()}: ${error.message}. Confirme que o processo está no ar (pm2 status).`,
      },
    };
  }
}

export function fetchWhatsappStatus() {
  return callBridge("/internal/whatsapp/status");
}

export function sendWhatsappMessage(to, message) {
  return callBridge("/internal/whatsapp/send", { method: "POST", body: JSON.stringify({ to, message }) });
}
