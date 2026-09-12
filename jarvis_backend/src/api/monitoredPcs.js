export function parseMonitoredWindowsPcs() {
  const raw = process.env.MONITORED_WINDOWS_PCS || "";

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator === -1) return { name: entry, host: entry };
      const name = entry.slice(0, separator).trim();
      const host = entry.slice(separator + 1).trim();
      if (!name || !host) return { name: entry, host: entry };
      return { name, host };
    });
}

export function findMonitoredPc(clinicName) {
  if (typeof clinicName !== "string" || !clinicName.trim()) return null;
  const wanted = clinicName.trim().toLowerCase();
  return (
    parseMonitoredWindowsPcs().find((pc) => pc.name.toLowerCase() === wanted || pc.host.toLowerCase() === wanted) || null
  );
}
