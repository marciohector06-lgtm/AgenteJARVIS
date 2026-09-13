import { existsSync, statSync, createReadStream } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";
import { VIDEO_DIR } from "../studio/paths.js";
import { getVideo, listRecent, pendingApprovals, recordDecision, markPosted, transition, STATES } from "../studio/pipeline.js";
import { getOffer } from "../studio/offers.js";

const CHUNK_SIZE = 1024 * 1024;

function isInsideVideoDir(filePath) {
  const normalized = resolve(filePath);
  const root = resolve(VIDEO_DIR);
  return normalized === root || normalized.startsWith(`${root}\\`) || normalized.startsWith(`${root}/`);
}

function summarize(video) {
  const offer = video.offerId ? getOffer(video.offerId) : null;

  return {
    id: video.id,
    state: video.state,
    offerId: video.offerId,
    productName: offer?.productName || null,
    category: offer?.category || null,
    hook: video.script?.hook || null,
    caption: video.script?.caption || null,
    hashtags: video.script?.hashtags || [],
    hookFormula: video.hookFormula,
    sceneFormat: video.sceneFormat,
    hasFile: Boolean(video.videoPath && existsSync(video.videoPath)),
    postedUrl: video.postedUrl,
    lastError: video.lastError,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
}

export function registerStudioRoutes(router) {
  router.get("/studio/pending", (req, res) => {
    try {
      return res.json({ videos: pendingApprovals().map(summarize) });
    } catch (error) {
      logger.error(`API studio: erro ao listar pendentes: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao listar vídeos pendentes." });
    }
  });

  router.get("/studio/videos", (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);

    try {
      return res.json({ videos: listRecent(limit).map(summarize) });
    } catch (error) {
      logger.error(`API studio: erro ao listar vídeos: ${error.stack || error.message}`);
      return res.status(500).json({ error: "Erro ao listar vídeos." });
    }
  });

  router.post("/studio/video/:id/decision", (req, res) => {
    const { decision } = req.body || {};

    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ error: "decision precisa ser 'approve' ou 'reject'." });
    }

    try {
      return res.json({ video: summarize(recordDecision(req.params.id, decision)) });
    } catch (error) {
      logger.warn(`API studio: decisão recusada para ${req.params.id}: ${error.message}`);
      return res.status(409).json({ error: error.message });
    }
  });

  router.post("/studio/video/:id/regenerate", (req, res) => {
    try {
      return res.json({ video: summarize(transition(req.params.id, STATES.DRAFT)) });
    } catch (error) {
      logger.warn(`API studio: refazer recusado para ${req.params.id}: ${error.message}`);
      return res.status(409).json({ error: error.message });
    }
  });

  router.post("/studio/video/:id/posted", (req, res) => {
    const { url } = req.body || {};

    if (!url || !String(url).startsWith("http")) {
      return res.status(400).json({ error: "url do post é obrigatória e precisa começar com http." });
    }

    try {
      return res.json({ video: summarize(markPosted(req.params.id, String(url).trim())) });
    } catch (error) {
      logger.warn(`API studio: marcar publicado recusado para ${req.params.id}: ${error.message}`);
      return res.status(409).json({ error: error.message });
    }
  });

  router.get("/studio/video/:id/file", (req, res) => {
    const video = getVideo(req.params.id);

    if (!video) return res.status(404).json({ error: "Vídeo não encontrado." });
    if (!video.videoPath) return res.status(409).json({ error: "Vídeo ainda não foi renderizado." });

    if (!isInsideVideoDir(video.videoPath)) {
      logger.error(`API studio: recusando servir caminho fora de VIDEO_DIR: ${video.videoPath}`);
      return res.status(403).json({ error: "Caminho de vídeo fora do diretório permitido." });
    }

    if (!existsSync(video.videoPath)) {
      return res.status(410).json({ error: "O arquivo do vídeo não está mais em disco." });
    }

    const { size } = statSync(video.videoPath);
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        "Content-Length": size,
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
      });
      return createReadStream(video.videoPath).pipe(res);
    }

    const start = Number.parseInt(range.replace(/\D/g, ""), 10) || 0;
    const end = Math.min(start + CHUNK_SIZE, size - 1);

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Content-Type": "video/mp4",
    });

    return createReadStream(video.videoPath, { start, end }).pipe(res);
  });
}
