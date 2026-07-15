import { exec } from "node:child_process";
import snmp from "net-snmp";
import wol from "wake_on_lan";

const VALID_HOST = /^[a-zA-Z0-9.\-:]+$/;
const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

function extractLatency(output) {
  const match =
    output.match(/(?:tempo|time)[=<]\s*([\d.]+)\s*ms/i) ||
    output.match(/(?:média|average)\s*=\s*([\d.]+)\s*ms/i) ||
    output.match(/(?:min\/avg\/max|rtt)\D+=\s*[\d.]+\/([\d.]+)\//i);
  return match ? `${match[1]}ms` : null;
}

export async function pingHost(target) {
  if (!VALID_HOST.test(target)) {
    throw new Error(`Alvo inválido: "${target}". Use apenas um IP ou domínio (ex: 8.8.8.8 ou google.com).`);
  }

  const countFlag = process.platform === "win32" ? "-n" : "-c";
  const command = `ping ${countFlag} 4 ${target}`;

  const output = await new Promise((resolve) => {
    exec(command, { timeout: 15_000 }, (error, stdout, stderr) => {
      resolve({ error, text: stdout || stderr || error?.message || "" });
    });
  });

  if (output.error) {
    return `Host "${target}" está OFFLINE ou inalcançável.\n\n${output.text}`;
  }

  const latency = extractLatency(output.text);
  return `Host "${target}" está ONLINE.${latency ? ` Latência média: ${latency}.` : ""}\n\n${output.text}`;
}

export async function getServerStatus(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(url, { method: "GET", signal: controller.signal });

    return response.status === 200
      ? `"${url}" está ONLINE (HTTP ${response.status}).`
      : `"${url}" respondeu, mas com status HTTP ${response.status} (${response.statusText}).`;
  } catch (error) {
    return `Não foi possível acessar "${url}": ${error.message}`;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function wakeOnLan(macAddress) {
  if (!MAC_REGEX.test(macAddress)) {
    throw new Error(`Endereço MAC inválido: "${macAddress}". Use o formato XX:XX:XX:XX:XX:XX.`);
  }

  return new Promise((resolve) => {
    wol.wake(macAddress, (error) => {
      resolve(
        error
          ? `Falha ao enviar magic packet para ${macAddress}: ${error.message}`
          : `Magic packet enviado para ${macAddress}. A máquina deve ligar em alguns segundos, se o Wake-on-LAN estiver habilitado na BIOS/placa de rede.`
      );
    });
  });
}

export function snmpGet(host, oid, community) {
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

export async function monitorInfra({ action, host, mac, oid, community }) {
  if (action === "ping") {
    if (!host) throw new Error("host é obrigatório para action='ping'.");
    return await pingHost(host);
  }

  if (action === "status") {
    if (!host) throw new Error("host é obrigatório para action='status'.");
    const url = /^https?:\/\//i.test(host) ? host : `http://${host}`;
    return await getServerStatus(url);
  }

  if (action === "wol") {
    if (!mac) throw new Error("mac é obrigatório para action='wol'.");
    return await wakeOnLan(mac);
  }

  if (action === "snmp_get") {
    if (!host || !oid) throw new Error("host e oid são obrigatórios para action='snmp_get'.");
    return await snmpGet(host, oid, community);
  }

  throw new Error(`Ação "${action}" inválida. Use: ping, status, wol, snmp_get.`);
}
