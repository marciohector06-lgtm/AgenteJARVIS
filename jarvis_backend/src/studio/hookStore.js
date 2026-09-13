import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const insertHook = db.prepare(`
  INSERT INTO hooks_mined (id, niche, sourceUrl, transcript, formula, mechanism, gripScore, rationale, views, minedAt)
  VALUES (@id, @niche, @sourceUrl, @transcript, @formula, @mechanism, @gripScore, @rationale, @views, @minedAt)
`);
const selectByUrl = db.prepare("SELECT id FROM hooks_mined WHERE sourceUrl = ?");
const selectByNiche = db.prepare(`
  SELECT * FROM hooks_mined
  WHERE niche LIKE ?
  ORDER BY gripScore DESC, views DESC
  LIMIT ?
`);
const selectTop = db.prepare("SELECT * FROM hooks_mined ORDER BY gripScore DESC, views DESC LIMIT ?");
const countHooks = db.prepare("SELECT COUNT(*) AS total FROM hooks_mined");

function toHook(row) {
  if (!row) return null;
  return {
    id: row.id,
    niche: row.niche,
    sourceUrl: row.sourceUrl,
    transcript: row.transcript,
    formula: row.formula,
    mechanism: row.mechanism,
    gripScore: row.gripScore,
    rationale: row.rationale,
    views: row.views,
    minedAt: row.minedAt,
  };
}

export function saveMinedHook({ niche, sourceUrl, transcript, formula, mechanism, gripScore, rationale, views = 0 }) {
  if (!sourceUrl) throw new Error("sourceUrl é obrigatório para guardar um gancho minerado.");
  if (selectByUrl.get(sourceUrl)) return null;

  const record = {
    id: randomUUID(),
    niche: String(niche || "").trim(),
    sourceUrl,
    transcript: String(transcript || "").trim(),
    formula: formula || null,
    mechanism: mechanism || null,
    gripScore: Number.isFinite(gripScore) ? gripScore : null,
    rationale: rationale || null,
    views: Number(views) || 0,
    minedAt: Date.now(),
  };

  insertHook.run(record);
  return toHook(record);
}

export async function searchMinedHooks(niche, { limit = 6 } = {}) {
  const term = String(niche || "").trim();

  const rows = term ? selectByNiche.all(`%${term.split(/[\s/]+/)[0]}%`, limit) : [];

  if (rows.length > 0) return rows.map(toHook);

  return selectTop.all(limit).map(toHook);
}

export function countMinedHooks() {
  return countHooks.get().total;
}
