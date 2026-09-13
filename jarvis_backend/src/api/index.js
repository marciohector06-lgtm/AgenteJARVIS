import express from "express";
import { remoteExecute } from "../../../jarvis_shared/src/remoteExec.js";
import { logger } from "../logger.js";
import { getHistory, recallMemory } from "../memory/index.js";
import { isKillSwitchActive } from "../security/killSwitch.js";
import { getWhatsappOwnerNumber, toWhatsappJid } from "../bot/whatsappAllowlist.js";
import { requireDeviceJwt } from "./requireDeviceJwt.js";
import { runGuarded, respondBlocked } from "./guardedExecution.js";
import { getClinicStatus } from "./clinicStatus.js";
import { findMonitoredPc } from "./monitoredPcs.js";
import { getRemoteCommand, listRemoteCommands } from "./remoteCommandCatalog.js";
import { BUSINESS_INTEGRATION_NAMES, getBusinessToolStatus } from "./businessStatus.js";
import { fetchWhatsappStatus, sendWhatsappMessage } from "./whatsappBridgeClient.js";
import { registerStudioRoutes } from "./studioRoutes.js";

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;
const DEFAULT_MEMORY_RESULTS = 5;
const MAX_MEMORY_RESULTS = 20;

function parseBoundedInteger(raw, fallback, max) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function createApiRouter() {
  const router = express.Router();

  router.get("/health", (req, res) =>
    res.json({ ok: true, service: "jarvis-backend", killSwitchActive: isKillSwitchActive() })
  );

  router.use(requireDeviceJwt);

  registerStudioRoutes(router);

  router.get("/security/kill-switch", (req, res) => res.json({ active: isKillSwitchActive() }));

  router.get("/whatsapp/status", async (req, res) => {
    const bridge = await fetchWhatsappStatus();
    return res.status(bridge.ok ? 200 : bridge.status).json(bridge.body);
  });

  router.get("/whatsapp/messages", (req, res) => {
    const limit = parseBoundedInteger(req.query.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
    const owner = getWhatsappOwnerNumber();
    const sessionId = req.query.contact ? toWhatsappJid(req.query.contact) : owner ? toWhatsappJid(owner) : null;

    if (!sessionId) {
      return res.status(400).json({
        error: "Sem destinatário: informe ?contact=<número> ou configure WHATSAPP_OWNER_NUMBER no .env.",
      });
    }

    try {
      const history = getHistory(sessionId, limit);
      return res.json({
        sessionId,
        limit,
        messages: history,
        aviso:
          "Isto é o histórico de conversa COM O AGENTE (tabela sessions), não a caixa de entrada do WhatsApp. Mensagens que não passaram pelo agente (comandos, confirmações, números fora da allowlist, grupos, mídia) não aparecem aqui.",
      });
    } catch (error) {
      logger.error(`API: erro ao ler histórico de WhatsApp: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao ler o histórico de conversa." });
    }
  });

  router.post("/whatsapp/send", async (req, res) => {
    const { to, message, confirmed } = req.body || {};

    if (!to || !message) {
      return res.status(400).json({ error: "to e message são obrigatórios." });
    }

    const description = `Enviar mensagem de WhatsApp para ${to}: "${String(message).slice(0, 120)}"`;

    try {
      const outcome = await runGuarded(description, { confirmed: confirmed === true }, () =>
        sendWhatsappMessage(to, message)
      );

      if (outcome.blocked) return respondBlocked(res, outcome.reason);

      const bridge = outcome.result;
      return res.status(bridge.ok ? 200 : bridge.status).json(bridge.body);
    } catch (error) {
      logger.error(`API: erro ao enviar WhatsApp: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao enviar a mensagem." });
    }
  });

  router.get("/network/clinics", async (req, res) => {
    try {
      const status = await getClinicStatus(req.query.clinic);

      if (!status.found) {
        return res.status(404).json({
          error: `Clínica "${req.query.clinic}" não está em MONITORED_WINDOWS_PCS.`,
        });
      }

      return res.json(status);
    } catch (error) {
      logger.error(`API: erro ao obter status das clínicas: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao obter o status das clínicas." });
    }
  });

  router.get("/network/commands", (req, res) => res.json({ commands: listRemoteCommands() }));

  router.post("/network/remote-command", async (req, res) => {
    const { clinic, command_id: commandId, confirmed } = req.body || {};

    if (!clinic || !commandId) {
      return res.status(400).json({ error: "clinic e command_id são obrigatórios." });
    }

    const command = getRemoteCommand(commandId);
    if (!command) {
      return res.status(400).json({
        error: `command_id "${commandId}" não está no catálogo aprovado.`,
        allowed: listRemoteCommands().map((entry) => entry.command_id),
      });
    }

    const pc = findMonitoredPc(clinic);
    if (!pc) {
      return res.status(404).json({ error: `Clínica "${clinic}" não está em MONITORED_WINDOWS_PCS.` });
    }

    const username = process.env.WINDOWS_REMOTE_USERNAME;
    const password = process.env.WINDOWS_REMOTE_PASSWORD;

    if (!username || !password) {
      return res.status(503).json({
        error:
          "WINDOWS_REMOTE_USERNAME e WINDOWS_REMOTE_PASSWORD não estão configurados no cérebro. A execução remota fica indisponível até que sejam definidos no .env — credenciais nunca são aceitas pelo cliente MCP.",
        reason: "credenciais_ausentes",
      });
    }

    const description = `Executar "${command.command_id}" (${command.description}) na máquina ${pc.name} (${pc.host})`;
    const requiresConfirmation = command.destructive;

    try {
      const outcome = await runGuarded(
        description,
        { confirmed: requiresConfirmation ? confirmed === true : true },
        () => remoteExecute({ host: pc.host, os: "windows", command: command.powershell, username, password })
      );

      if (outcome.blocked) return respondBlocked(res, outcome.reason);

      const execution = outcome.result;
      return res.json({
        clinic: pc.name,
        host: pc.host,
        command_id: command.command_id,
        destructive: command.destructive,
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr,
      });
    } catch (error) {
      logger.error(`API: erro na execução remota: ${error.stack || error.message}`);
      return res.status(502).json({ error: `Falha ao executar em ${pc.name}: ${error.message}` });
    }
  });

  router.get("/business/status/:tool", (req, res) => {
    const status = getBusinessToolStatus(req.params.tool);

    if (!status) {
      return res.status(400).json({
        error: `Integração "${req.params.tool}" desconhecida.`,
        allowed: BUSINESS_INTEGRATION_NAMES,
      });
    }

    return res.json(status);
  });

  router.post("/memory/search", async (req, res) => {
    const { query, top_k: topK } = req.body || {};

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "query é obrigatória e deve ser um texto não vazio." });
    }

    const nResults = parseBoundedInteger(topK, DEFAULT_MEMORY_RESULTS, MAX_MEMORY_RESULTS);

    try {
      const documents = await recallMemory(query, nResults);
      return res.json({
        query,
        top_k: nResults,
        documents,
        aviso:
          documents.length === 0
            ? "Lista vazia pode significar tanto ausência de resultados quanto ChromaDB indisponível — recallMemory degrada em silêncio e devolve [] nos dois casos."
            : undefined,
      });
    } catch (error) {
      logger.error(`API: erro na busca de memória: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao buscar na memória." });
    }
  });

  return router;
}
