const CATALOG = Object.freeze({
  disk_free: {
    description: "Espaço livre e usado no disco C.",
    destructive: false,
    powershell: "Get-PSDrive -Name C | Select-Object -Property Used,Free | ConvertTo-Json -Compress",
  },
  uptime: {
    description: "Data e hora do último boot da máquina.",
    destructive: false,
    powershell: "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime",
  },
  top_processes: {
    description: "Dez processos que mais consomem memória.",
    destructive: false,
    powershell:
      "Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 10 Name,Id,WS | ConvertTo-Json -Compress",
  },
  spooler_status: {
    description: "Estado atual do serviço de spooler de impressão.",
    destructive: false,
    powershell: "Get-Service -Name Spooler | Select-Object -Property Status | ConvertTo-Json -Compress",
  },
  pending_updates_count: {
    description: "Quantidade de atualizações do Windows pendentes de reinicialização.",
    destructive: false,
    powershell:
      "(Get-ChildItem -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired' -ErrorAction SilentlyContinue | Measure-Object).Count",
  },
  restart_print_spooler: {
    description: "Reinicia o serviço de spooler de impressão.",
    destructive: true,
    powershell: "Restart-Service -Name Spooler -Force",
  },
  clear_print_queue: {
    description: "Limpa a fila de impressão travada e reinicia o spooler.",
    destructive: true,
    powershell:
      "Stop-Service -Name Spooler -Force; Remove-Item -Path $env:SystemRoot\\System32\\spool\\PRINTERS\\* -Force -ErrorAction SilentlyContinue; Start-Service -Name Spooler",
  },
  flush_dns: {
    description: "Limpa o cache de DNS da máquina.",
    destructive: true,
    powershell: "Clear-DnsClientCache",
  },
  restart_explorer: {
    description: "Reinicia o Windows Explorer (recupera a barra de tarefas travada).",
    destructive: true,
    powershell: "Stop-Process -Name explorer -Force",
  },
});

export function listRemoteCommands() {
  return Object.entries(CATALOG).map(([id, entry]) => ({
    command_id: id,
    description: entry.description,
    destructive: entry.destructive,
  }));
}

export function getRemoteCommand(commandId) {
  if (typeof commandId !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(CATALOG, commandId)) return null;
  return { command_id: commandId, ...CATALOG[commandId] };
}

export function isKnownRemoteCommand(commandId) {
  return getRemoteCommand(commandId) !== null;
}
