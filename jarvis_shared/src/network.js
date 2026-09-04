import { exec } from "node:child_process";
import dns from "node:dns/promises";
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

// Escreve um OID via SNMP SET (ex: ifAdminStatus down(2)/up(1) pra reiniciar
// uma porta de switch gerenciável — RFC 2863, padrão, não específico de
// fabricante). O switch precisa ter a community configurada com permissão
// de escrita (read-write), não só leitura.
export function snmpSet(host, oid, type, value, community) {
  return new Promise((resolve, reject) => {
    const session = snmp.createSession(host, community || "private");
    const resolvedType = typeof type === "string" ? snmp.ObjectType[type] : type;

    if (resolvedType === undefined) {
      session.close();
      return reject(new Error(`Tipo SNMP "${type}" inválido.`));
    }

    session.set([{ oid, type: resolvedType, value }], (error, varbinds) => {
      session.close();

      if (error) return reject(error);

      const varbind = varbinds[0];
      if (snmp.isVarbindError(varbind)) {
        return reject(new Error(snmp.varbindError(varbind)));
      }

      resolve({ oid: varbind.oid, value: varbind.value?.toString?.() ?? varbind.value });
    });

    session.on("error", (error) => {
      session.close();
      reject(error);
    });
  });
}

function execCommand(command, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

// Windows: "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
// Linux:   "192.168.1.1              ether   aa:bb:cc:dd:ee:ff   C   eth0" (arp -n)
function parseArpTable(raw) {
  const entries = [];
  const regex = /(\d{1,3}(?:\.\d{1,3}){3})[\s\S]{0,40}?([0-9a-fA-F]{2}([-:][0-9a-fA-F]{2}){5})/g;
  let match;
  while ((match = regex.exec(raw))) {
    entries.push({ ip: match[1], mac: match[2].replace(/-/g, ":").toLowerCase() });
  }
  return entries;
}

// Heurística simples de "tipo de dispositivo" a partir do fabricante (OUI) —
// não é confiável, é só uma sugestão pra facilitar identificação visual.
const DEVICE_TYPE_HINTS = [
  { keyword: /apple/i, type: "dispositivo Apple (celular/notebook)" },
  { keyword: /intelbras/i, type: "equipamento Intelbras (câmera/switch/roteador)" },
  { keyword: /espressif|tuya|shenzhen/i, type: "dispositivo IoT" },
  { keyword: /hewlett|canon|brother|epson/i, type: "impressora" },
  { keyword: /raspberry/i, type: "Raspberry Pi" },
  { keyword: /microsoft|dell|lenovo/i, type: "PC/notebook" },
  { keyword: /samsung|xiaomi|huawei|motorola/i, type: "celular/eletrônico" },
];

function guessDeviceType(vendor) {
  if (!vendor) return "desconhecido";
  const hit = DEVICE_TYPE_HINTS.find((h) => h.keyword.test(vendor));
  return hit ? hit.type : "desconhecido";
}

// api.macvendors.com é pública, gratuita e tem rate limit — falha aqui é
// esperada às vezes e não deve derrubar o scan inteiro.
async function lookupVendor(mac) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);

  try {
    const response = await fetch(`https://api.macvendors.com/${mac}`, { signal: controller.signal });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function reverseLookup(ip) {
  try {
    const names = await dns.reverse(ip);
    return names[0] || null;
  } catch {
    return null;
  }
}

function autoName(hostname, vendor, ip) {
  if (hostname) return hostname;
  const lastOctet = ip.split(".").pop();
  return vendor ? `${vendor.split(" ")[0]}-${lastOctet}` : `Dispositivo-${lastOctet}`;
}

// Scan de rede real: ping sweep (popula a tabela ARP do SO) + leitura da
// tabela ARP (arp -a/-n) + fabricante via MAC (macvendors.com, best-effort)
// + hostname via reverse DNS (best-effort) + nome automático de fallback.
// Só suporta /24 por simplicidade (254 hosts, sweep paralelo).
export async function scanNetwork(subnetCidr) {
  const match = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\/24$/.exec(subnetCidr || "");
  if (!match) {
    throw new Error(`Subnet "${subnetCidr}" inválida — use o formato "192.168.1.0/24" (só /24 suportado).`);
  }

  const base = match[1];
  const countFlag = process.platform === "win32" ? "-n" : "-c";
  const timeoutFlag = process.platform === "win32" ? "-w 300" : "-W 1";

  const sweeps = [];
  for (let i = 1; i <= 254; i++) {
    sweeps.push(execCommand(`ping ${countFlag} 1 ${timeoutFlag} ${base}.${i}`, 3_000));
  }
  await Promise.all(sweeps);

  const arpCommand = process.platform === "win32" ? "arp -a" : "arp -n";
  const { stdout } = await execCommand(arpCommand, 10_000);
  const entries = parseArpTable(stdout).filter((entry) => entry.ip.startsWith(`${base}.`));

  return Promise.all(
    entries.map(async (entry) => {
      const [vendor, hostname] = await Promise.all([lookupVendor(entry.mac), reverseLookup(entry.ip)]);
      return {
        ip: entry.ip,
        mac: entry.mac,
        vendor,
        deviceType: guessDeviceType(vendor),
        hostname,
        name: autoName(hostname, vendor, entry.ip),
      };
    })
  );
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
