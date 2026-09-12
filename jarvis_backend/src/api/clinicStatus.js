import { listDevices } from "../tools/tailscaleManagerTool.js";
import { parseMonitoredWindowsPcs, findMonitoredPc } from "./monitoredPcs.js";

function indexDevices(devices) {
  const byHostname = new Map();
  const byIp = new Map();

  for (const device of devices) {
    if (device.hostname) byHostname.set(String(device.hostname).toLowerCase(), device);
    for (const ip of device.tailscaleIPs || []) byIp.set(String(ip).toLowerCase(), device);
  }

  return { byHostname, byIp };
}

function resolveDevice({ byHostname, byIp }, pc) {
  const hostKey = pc.host.toLowerCase();
  const nameKey = pc.name.toLowerCase();

  if (byHostname.has(hostKey)) return { device: byHostname.get(hostKey), matchedBy: "hostname" };
  if (byIp.has(hostKey)) return { device: byIp.get(hostKey), matchedBy: "tailscale_ip" };
  if (byHostname.has(nameKey)) return { device: byHostname.get(nameKey), matchedBy: "nome_configurado" };
  return { device: null, matchedBy: null };
}

export async function getClinicStatus(clinicFilter) {
  const monitored = clinicFilter ? [findMonitoredPc(clinicFilter)].filter(Boolean) : parseMonitoredWindowsPcs();

  if (clinicFilter && monitored.length === 0) {
    return { found: false, clinics: [], total: 0, online: 0, tailscaleError: null };
  }

  let devices = [];
  let tailscaleError = null;

  try {
    devices = await listDevices();
  } catch (error) {
    tailscaleError = error.message;
  }

  const index = indexDevices(devices);

  const clinics = monitored.map((pc) => {
    const { device, matchedBy } = resolveDevice(index, pc);
    return {
      name: pc.name,
      host: pc.host,
      online: device ? Boolean(device.online) : false,
      os: device ? device.os ?? null : null,
      lastSeen: device ? device.lastSeen ?? null : null,
      matchedBy,
    };
  });

  return {
    found: true,
    clinics,
    total: clinics.length,
    online: clinics.filter((clinic) => clinic.online).length,
    tailscaleError,
  };
}
