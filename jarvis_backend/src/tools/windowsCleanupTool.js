import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { remoteExecute } from "../../../jarvis_shared/src/remoteExec.js";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

// Lista de caminhos limpos por padrão — Temp do usuário, cache Chrome/Edge,
// Prefetch e a Lixeira. "logs antigos" fica de fora do padrão por ser
// perigoso demais generalizar (poderia apagar log de outra aplicação
// importante) — o usuário pode passar caminhos extras em extraPaths.
const DEFAULT_CLEANUP_PATHS = [
  "$env:TEMP",
  "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cache",
  "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Cache",
  "C:\\Windows\\Prefetch",
];

// Mede o tamanho de uma lista de caminhos (em bytes), limpa, mede de novo —
// o "espaço liberado" é a diferença real medida, não uma estimativa.
function buildCleanupScript(paths, includeRecycleBin) {
  const pathsList = paths.map((p) => `"${p}"`).join(", ");

  return `
$paths = @(${pathsList})
function Get-TotalSize($paths) {
  $total = 0
  foreach ($p in $paths) {
    if (Test-Path $p) {
      $total += (Get-ChildItem -Path $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
    }
  }
  return $total
}
$before = Get-TotalSize $paths
foreach ($p in $paths) {
  if (Test-Path $p) {
    Remove-Item -Path "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue
  }
}
${includeRecycleBin ? "Clear-RecycleBin -Force -ErrorAction SilentlyContinue" : ""}
$after = Get-TotalSize $paths
$freedBytes = [math]::Max(0, $before - $after)
[PSCustomObject]@{ freedBytes = $freedBytes; beforeBytes = $before; afterBytes = $after } | ConvertTo-Json -Compress
`.trim();
}

export const windowsCleanupTool = tool(
  async ({ hosts, username, password, includeRecycleBin = true, extraPaths = [] }) => {
    const paths = [...DEFAULT_CLEANUP_PATHS, ...extraPaths];
    const description = `Limpar Temp/cache Chrome-Edge/Prefetch${includeRecycleBin ? "/Lixeira" : ""} em ${hosts.length} PC(s): ${hosts.join(", ")}`;

    return guardExecution(description, { destructive: true }, async () => {
      const script = buildCleanupScript(paths, includeRecycleBin);

      const results = await Promise.all(
        hosts.map(async (host) => {
          try {
            const result = await remoteExecute({ host, os: "windows", command: script, username, password });

            let report;
            try {
              report = JSON.parse(result.stdout);
            } catch {
              report = { error: "Não foi possível interpretar o relatório de limpeza.", raw: result.stdout };
            }

            logger.info(`windows_cleanup_tool host=${host} freedBytes=${report.freedBytes ?? "?"}`);
            return { host, ...report };
          } catch (error) {
            logger.error(`windows_cleanup_tool host=${host} erro=${error.message}`);
            return { host, error: error.message };
          }
        })
      );

      const totalFreedBytes = results.reduce((sum, r) => sum + (r.freedBytes || 0), 0);
      return JSON.stringify({ totalFreedBytes, results });
    });
  },
  {
    name: "windows_cleanup_tool",
    description:
      "Limpa Temp, cache do Chrome/Edge e Prefetch (e opcionalmente a Lixeira) em um ou mais PCs Windows via WinRM, endereçados por IP Tailscale ou local. Roda em paralelo em todos os hosts e retorna quantos bytes foram liberados por PC (medido de verdade, antes/depois — não é estimativa). Sempre destrutivo — passa por confirmação.",
    schema: z.object({
      hosts: z.array(z.string()).describe("Lista de IPs (Tailscale ou local) dos PCs alvo — passe os 13 PCs pra limpar todos de uma vez"),
      username: z.string().describe("Usuário para autenticação WinRM"),
      password: z.string().describe("Senha do usuário (WinRM/PSCredential)"),
      includeRecycleBin: z.boolean().optional().describe("Também esvaziar a Lixeira (padrão: true)"),
      extraPaths: z
        .array(z.string())
        .optional()
        .describe("Caminhos extras a limpar além dos padrões (ex: pasta de logs de uma aplicação específica)"),
    }),
  }
);
