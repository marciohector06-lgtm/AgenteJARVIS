import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const insertOffer = db.prepare(`
  INSERT INTO offers (id, productName, category, link, commission, hashtags, active, createdAt, updatedAt)
  VALUES (@id, @productName, @category, @link, @commission, @hashtags, @active, @createdAt, @updatedAt)
`);
const selectOffer = db.prepare("SELECT * FROM offers WHERE id = ?");
const selectAllOffers = db.prepare("SELECT * FROM offers ORDER BY createdAt DESC");
const selectActiveOffers = db.prepare("SELECT * FROM offers WHERE active = 1 ORDER BY createdAt DESC");
const updateOfferRow = db.prepare(`
  UPDATE offers
  SET productName = @productName,
      category = @category,
      link = @link,
      commission = @commission,
      hashtags = @hashtags,
      updatedAt = @updatedAt
  WHERE id = @id
`);
const updateOfferActive = db.prepare("UPDATE offers SET active = ?, updatedAt = ? WHERE id = ?");

function requireText(value, field, why) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${field} é obrigatório: ${why}`);
  return text;
}

function normalizeHashtags(hashtags) {
  const list = Array.isArray(hashtags)
    ? hashtags
    : String(hashtags ?? "")
        .split(/[\s,]+/)
        .filter(Boolean);

  return list
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`));
}

function toOffer(row) {
  if (!row) return null;

  let hashtags = [];
  try {
    hashtags = JSON.parse(row.hashtags);
  } catch {
    hashtags = [];
  }

  return {
    id: row.id,
    productName: row.productName,
    category: row.category,
    link: row.link,
    commission: row.commission,
    hashtags,
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createOffer({ id, productName, category, link = "", commission = 0, hashtags = [] } = {}) {
  const now = Date.now();

  const record = {
    id: String(id ?? "").trim() || randomUUID(),
    productName: requireText(
      productName,
      "productName",
      "é o item exato que aparece no vídeo; sem ele o roteiro descreve outro produto",
    ),
    category: requireText(
      category,
      "category",
      "define o tom e o vocabulário que o roteirista usa nesse nicho",
    ),
    link: String(link ?? "").trim(),
    commission: Number(commission) || 0,
    hashtags: JSON.stringify(normalizeHashtags(hashtags)),
    active: 1,
    createdAt: now,
    updatedAt: now,
  };

  if (selectOffer.get(record.id)) {
    throw new Error(`Já existe uma oferta com o id "${record.id}".`);
  }

  insertOffer.run(record);
  return toOffer(selectOffer.get(record.id));
}

export function getOffer(id) {
  return toOffer(selectOffer.get(String(id)));
}

export function listOffers({ activeOnly = false } = {}) {
  const rows = activeOnly ? selectActiveOffers.all() : selectAllOffers.all();
  return rows.map(toOffer);
}

export function updateOffer(id, changes = {}) {
  const current = getOffer(id);
  if (!current) throw new Error(`Oferta "${id}" não encontrada.`);

  const merged = {
    id: current.id,
    productName: requireText(
      changes.productName ?? current.productName,
      "productName",
      "é o item exato que aparece no vídeo; sem ele o roteiro descreve outro produto",
    ),
    category: requireText(
      changes.category ?? current.category,
      "category",
      "define o tom e o vocabulário que o roteirista usa nesse nicho",
    ),
    link: String(changes.link ?? current.link).trim(),
    commission: Number(changes.commission ?? current.commission) || 0,
    hashtags: JSON.stringify(normalizeHashtags(changes.hashtags ?? current.hashtags)),
    updatedAt: Date.now(),
  };

  updateOfferRow.run(merged);
  return getOffer(current.id);
}

export function setOfferActive(id, active) {
  const current = getOffer(id);
  if (!current) throw new Error(`Oferta "${id}" não encontrada.`);

  updateOfferActive.run(active ? 1 : 0, Date.now(), current.id);
  return getOffer(current.id);
}
