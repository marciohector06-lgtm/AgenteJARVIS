import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { db } from "./db.js";
import { logger } from "../logger.js";

export const studioEvents = new EventEmitter();

export const STATES = {
  DRAFT: "draft",
  RENDERED: "rendered",
  AWAITING_APPROVAL: "awaiting_approval",
  APPROVED: "approved",
  REJECTED: "rejected",
  POSTED: "posted",
  MEASURED: "measured",
  FAILED: "failed",
};

const ALLOWED_TRANSITIONS = {
  [STATES.DRAFT]: [STATES.RENDERED, STATES.FAILED],
  [STATES.RENDERED]: [STATES.AWAITING_APPROVAL, STATES.FAILED],
  [STATES.AWAITING_APPROVAL]: [STATES.APPROVED, STATES.REJECTED, STATES.DRAFT, STATES.FAILED],
  [STATES.APPROVED]: [STATES.POSTED, STATES.FAILED],
  [STATES.REJECTED]: [STATES.DRAFT],
  [STATES.POSTED]: [STATES.MEASURED],
  [STATES.MEASURED]: [],
  [STATES.FAILED]: [STATES.DRAFT],
};

const insertVideo = db.prepare(`
  INSERT INTO videos (id, offerId, state, baseVideoPath, createdAt, updatedAt)
  VALUES (@id, @offerId, @state, @baseVideoPath, @createdAt, @updatedAt)
`);
const selectVideo = db.prepare("SELECT * FROM videos WHERE id = ?");
const selectByState = db.prepare("SELECT * FROM videos WHERE state = ? ORDER BY createdAt ASC");
const selectRecent = db.prepare("SELECT * FROM videos ORDER BY createdAt DESC LIMIT ?");
const updateState = db.prepare("UPDATE videos SET state = ?, updatedAt = ? WHERE id = ?");
const updateFields = db.prepare(`
  UPDATE videos
  SET scriptJson = COALESCE(@scriptJson, scriptJson),
      hookFormula = COALESCE(@hookFormula, hookFormula),
      sceneFormat = COALESCE(@sceneFormat, sceneFormat),
      audioPath = COALESCE(@audioPath, audioPath),
      videoPath = COALESCE(@videoPath, videoPath),
      baseVideoPath = COALESCE(@baseVideoPath, baseVideoPath),
      postedUrl = COALESCE(@postedUrl, postedUrl),
      lastError = @lastError,
      updatedAt = @updatedAt
  WHERE id = @id
`);
const insertHookResult = db.prepare(`
  INSERT INTO hook_results (id, videoId, hookText, hookFormula, sceneFormat, decision, createdAt)
  VALUES (@id, @videoId, @hookText, @hookFormula, @sceneFormat, @decision, @createdAt)
`);

function toVideo(row) {
  if (!row) return null;

  let script = null;
  if (row.scriptJson) {
    try {
      script = JSON.parse(row.scriptJson);
    } catch {
      script = null;
    }
  }

  return {
    id: row.id,
    offerId: row.offerId,
    state: row.state,
    baseVideoPath: row.baseVideoPath,
    script,
    hookFormula: row.hookFormula,
    sceneFormat: row.sceneFormat,
    audioPath: row.audioPath,
    videoPath: row.videoPath,
    postedUrl: row.postedUrl,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createVideo({ offerId, baseVideoPath = null } = {}) {
  if (!offerId) throw new Error("offerId é obrigatório para criar um vídeo.");

  const now = Date.now();
  const id = randomUUID();

  insertVideo.run({ id, offerId, state: STATES.DRAFT, baseVideoPath, createdAt: now, updatedAt: now });

  return toVideo(selectVideo.get(id));
}

export function getVideo(id) {
  return toVideo(selectVideo.get(String(id)));
}

export function listByState(state) {
  return selectByState.all(state).map(toVideo);
}

export function listRecent(limit = 20) {
  return selectRecent.all(limit).map(toVideo);
}

export function pendingApprovals() {
  return listByState(STATES.AWAITING_APPROVAL);
}

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

export function transition(id, nextState, changes = {}) {
  const current = getVideo(id);
  if (!current) throw new Error(`Vídeo "${id}" não encontrado.`);

  if (!canTransition(current.state, nextState)) {
    throw new Error(`Transição inválida: ${current.state} → ${nextState} (vídeo ${id}).`);
  }

  const now = Date.now();

  updateFields.run({
    id: current.id,
    scriptJson: changes.script ? JSON.stringify(changes.script) : null,
    hookFormula: changes.hookFormula ?? null,
    sceneFormat: changes.sceneFormat ?? null,
    audioPath: changes.audioPath ?? null,
    videoPath: changes.videoPath ?? null,
    baseVideoPath: changes.baseVideoPath ?? null,
    postedUrl: changes.postedUrl ?? null,
    lastError: nextState === STATES.FAILED ? changes.lastError ?? null : null,
    updatedAt: now,
  });

  updateState.run(nextState, now, current.id);

  logger.info(`studio pipeline: ${current.id} ${current.state} → ${nextState}`);

  return getVideo(current.id);
}

export function submitForApproval(id) {
  const video = getVideo(id);
  if (!video) throw new Error(`Vídeo "${id}" não encontrado.`);

  if (!video.videoPath || !existsSync(video.videoPath)) {
    throw new Error(`Vídeo "${id}" não tem arquivo renderizado em disco — não dá para aprovar o que não existe.`);
  }

  const updated = transition(id, STATES.AWAITING_APPROVAL);
  studioEvents.emit("pending", updated);

  return updated;
}

export function recordDecision(id, decision) {
  const video = getVideo(id);
  if (!video) throw new Error(`Vídeo "${id}" não encontrado.`);

  const nextState = decision === "approve" ? STATES.APPROVED : STATES.REJECTED;
  const updated = transition(id, nextState);

  insertHookResult.run({
    id: randomUUID(),
    videoId: video.id,
    hookText: video.script?.hook || "",
    hookFormula: video.hookFormula,
    sceneFormat: video.sceneFormat,
    decision: nextState,
    createdAt: Date.now(),
  });

  studioEvents.emit("decided", updated);

  return updated;
}

export function markPosted(id, postedUrl) {
  if (!postedUrl) throw new Error("postedUrl é obrigatório para marcar como publicado.");
  return transition(id, STATES.POSTED, { postedUrl });
}

export function markFailed(id, error) {
  return transition(id, STATES.FAILED, { lastError: String(error?.message || error || "erro desconhecido") });
}
