import { db } from "./db.js";
import { logger } from "../logger.js";
import { listByState, transition, STATES } from "./pipeline.js";
import { withMinerBrowser, enrichWithEngagement, parseVideoUrl } from "./hookMiner.js";

const updateHookResultMetrics = db.prepare(`
  UPDATE hook_results
  SET views = @views, likes = @likes, comments = @comments, shares = @shares, measuredAt = @measuredAt
  WHERE videoId = @videoId
`);

const selectFormulaPerformance = db.prepare(`
  SELECT hookFormula,
         COUNT(*) AS total,
         SUM(CASE WHEN decision = 'approved' THEN 1 ELSE 0 END) AS aprovados,
         AVG(COALESCE(likes, 0)) AS mediaLikes,
         AVG(COALESCE(comments, 0)) AS mediaComentarios
  FROM hook_results
  WHERE hookFormula IS NOT NULL
  GROUP BY hookFormula
  ORDER BY mediaLikes DESC
`);

export function formulaPerformance() {
  return selectFormulaPerformance.all().map((row) => ({
    hookFormula: row.hookFormula,
    total: row.total,
    aprovados: row.aprovados,
    taxaAprovacao: row.total > 0 ? Number(((row.aprovados / row.total) * 100).toFixed(1)) : 0,
    mediaLikes: Math.round(row.mediaLikes || 0),
    mediaComentarios: Math.round(row.mediaComentarios || 0),
  }));
}

export async function measurePostedVideos({ limit = 10 } = {}) {
  const posted = listByState(STATES.POSTED)
    .filter((video) => video.postedUrl && parseVideoUrl(video.postedUrl))
    .slice(0, limit);

  if (posted.length === 0) {
    logger.info("studio measurement: nenhum vídeo publicado aguardando medição");
    return [];
  }

  logger.info(`studio measurement: medindo ${posted.length} vídeo(s) publicado(s)`);

  const candidates = posted.map((video) => ({
    videoId: video.id,
    videoUrl: video.postedUrl,
    cardLikes: 0,
    caption: "",
  }));

  const measured = await withMinerBrowser(
    (page) => enrichWithEngagement(page, candidates, { limit: posted.length }),
    { requireSession: false },
  );

  const results = [];

  for (const item of measured) {
    updateHookResultMetrics.run({
      videoId: item.videoId,
      views: 0,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      measuredAt: Date.now(),
    });

    try {
      transition(item.videoId, STATES.MEASURED);
    } catch (error) {
      logger.warn(`studio measurement: não deu para marcar ${item.videoId} como medido: ${error.message}`);
    }

    results.push({
      videoId: item.videoId,
      likes: item.likes,
      comments: item.comments,
      shares: item.shares,
      conversationRate: item.conversationRate,
    });

    logger.info(`studio measurement: ${item.videoId} — ${item.likes} likes, ${item.comments} comentários, ${item.shares} shares`);
  }

  return results;
}
