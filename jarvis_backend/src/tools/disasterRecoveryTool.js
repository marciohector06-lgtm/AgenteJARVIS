import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import cron from "node-cron";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";
import { notifyTelegram } from "../proactive/telegramNotifier.js";

const require = createRequire(import.meta.url);
const archiver = require("archiver");
archiver.registerFormat("zip-encrypted", require("archiver-zip-encrypted"));

const CRON_SCHEDULE = "0 3 * * *";
const CRON_TIMEZONE = "America/Sao_Paulo";

function timestampForFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes()
  )}${pad(now.getSeconds())}`;
}

function createEncryptedZip(sourcePaths, zipPath, password) {
  return new Promise((resolve, reject) => {
    mkdirSync(path.dirname(zipPath), { recursive: true });
    const output = createWriteStream(zipPath);
    const archive = archiver.create("zip-encrypted", {
      zlib: { level: 8 },
      encryptionMethod: "zip20",
      password,
    });

    output.on("close", () => resolve(archive.pointer()));
    archive.on("error", reject);
    archive.pipe(output);

    let included = 0;
    for (const sourcePath of sourcePaths) {
      if (!existsSync(sourcePath)) continue;
      included++;
      const stats = statSync(sourcePath);
      const name = path.basename(sourcePath);
      if (stats.isDirectory()) {
        archive.directory(sourcePath, name);
      } else {
        archive.file(sourcePath, { name });
      }
    }

    if (included === 0) {
      archive.abort();
      return reject(new Error("Nenhum dos sourcePaths existe no disco."));
    }

    archive.finalize();
  });
}

function extractEncryptedZip(zipPath, destination, password) {
  return new Promise((resolve, reject) => {
    mkdirSync(destination, { recursive: true });
    execFile("unzip", ["-o", "-P", password, zipPath, "-d", destination], (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr || error.message));
      resolve(stdout);
    });
  });
}

export function listBackups(destination) {
  if (!existsSync(destination)) return [];
  return readdirSync(destination)
    .filter((name) => /^jarvis-backup-.*\.zip$/.test(name))
    .map((name) => {
      const fullPath = path.join(destination, name);
      const stats = statSync(fullPath);
      return { name, path: fullPath, sizeBytes: stats.size, modifiedAt: stats.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export const disasterRecoveryTool = tool(
  async ({ action, sourcePaths, destination, backupFile }) => {
    const password = process.env.BACKUP_PASSWORD;

    if (action === "list") {
      if (!destination) return "destination é obrigatório para action='list'.";
      const backups = listBackups(destination);
      logger.info(`disaster_recovery_tool action=list destination=${destination} total=${backups.length}`);
      return JSON.stringify(backups);
    }

    if (action === "backup") {
      if (!sourcePaths?.length) return "sourcePaths é obrigatório (array não vazio) para action='backup'.";
      if (!destination) return "destination é obrigatório para action='backup'.";
      if (!password) return "BACKUP_PASSWORD não está configurado no .env — necessário para criptografar o backup.";

      const fileName = `jarvis-backup-${timestampForFilename()}.zip`;
      const zipPath = path.join(destination, fileName);
      const description = `Criar backup criptografado de ${sourcePaths.length} caminho(s) em "${zipPath}". ATENÇÃO: destination deve ser máquina/disco diferente da fonte dos dados.`;

      return await guardExecution(description, { destructive: true }, async () => {
        try {
          const sizeBytes = await createEncryptedZip(sourcePaths, zipPath, password);
          logger.info(`disaster_recovery_tool action=backup zipPath=${zipPath} sizeBytes=${sizeBytes}`);
          return JSON.stringify({
            status: "ok",
            file: fileName,
            path: zipPath,
            sizeBytes,
            warning:
              "destination deve ser uma máquina ou disco DIFERENTE da fonte dos dados — a tool não valida isso automaticamente.",
          });
        } catch (error) {
          logger.error(`disaster_recovery_tool action=backup erro=${error.message}`);
          return JSON.stringify({ status: "error", message: error.message });
        }
      });
    }

    if (action === "restore") {
      if (!backupFile) return "backupFile é obrigatório (caminho completo do .zip) para action='restore'.";
      if (!destination) return "destination é obrigatório (pasta de destino da restauração) para action='restore'.";
      if (!password) return "BACKUP_PASSWORD não está configurado no .env — necessário para descriptografar o backup.";
      if (!existsSync(backupFile)) return `Arquivo de backup "${backupFile}" não encontrado.`;

      const description = `Restaurar backup "${backupFile}" em "${destination}"`;

      return await guardExecution(description, { destructive: true }, async () => {
        try {
          await extractEncryptedZip(backupFile, destination, password);
          logger.info(`disaster_recovery_tool action=restore backupFile=${backupFile} destination=${destination}`);
          return JSON.stringify({ status: "ok", backupFile, destination });
        } catch (error) {
          logger.error(`disaster_recovery_tool action=restore erro=${error.message}`);
          return JSON.stringify({ status: "error", message: error.message });
        }
      });
    }

    return `Ação "${action}" inválida. Use: backup, list, restore.`;
  },
  {
    name: "disaster_recovery_tool",
    description:
      "Backup e restore com senha (BACKUP_PASSWORD). 'backup': zipa sourcePaths (array de arquivos/diretórios) com senha, salva em destination como jarvis-backup-YYYY-MM-DD-HHmmss.zip. 'list': lista backups existentes em destination. 'restore': descriptografa e extrai backupFile (caminho completo do .zip) em destination. IMPORTANTE: destination deve ser uma máquina/disco diferente da fonte dos dados — a tool não valida isso, avise o usuário.",
    schema: z.object({
      action: z.enum(["backup", "list", "restore"]).describe("Ação a executar"),
      sourcePaths: z
        .array(z.string())
        .optional()
        .describe("Caminhos (arquivos ou diretórios) a incluir no backup, necessário para action='backup'"),
      destination: z
        .string()
        .describe("Diretório onde os backups ficam armazenados (backup/list) ou pasta de destino da extração (restore)"),
      backupFile: z
        .string()
        .optional()
        .describe("Caminho completo do arquivo .zip a restaurar, necessário para action='restore'"),
    }),
  }
);

async function runScheduledBackup() {
  const password = process.env.BACKUP_PASSWORD;
  const destination = process.env.BACKUP_DESTINATION;

  if (!password || !destination) {
    logger.error(
      "disaster_recovery_tool cron: BACKUP_PASSWORD ou BACKUP_DESTINATION ausente no .env — backup automático abortado."
    );
    return;
  }

  const sourcePaths = [process.env.SQLITE_PATH || "./jarvis.db", process.env.CHROMA_PATH, "./src"].filter(Boolean);

  const fileName = `jarvis-backup-${timestampForFilename()}.zip`;
  const zipPath = path.join(destination, fileName);

  logger.info(`disaster_recovery_tool cron: iniciando backup automático -> ${zipPath}`);

  try {
    const sizeBytes = await createEncryptedZip(sourcePaths, zipPath, password);
    logger.info(`disaster_recovery_tool cron: backup automático concluído -> ${zipPath} (${sizeBytes} bytes)`);
  } catch (error) {
    logger.error(`disaster_recovery_tool cron: falha no backup automático: ${error.message}`);
    await notifyTelegram(`🔴 Alerta: o backup automático falhou.\n\nErro: ${error.message}`);
  }
}

export function startDisasterRecoveryCron() {
  cron.schedule(CRON_SCHEDULE, runScheduledBackup, { timezone: CRON_TIMEZONE });
  logger.info(`disaster_recovery_tool: backup automático agendado (cron "${CRON_SCHEDULE}", timezone ${CRON_TIMEZONE})`);
}
