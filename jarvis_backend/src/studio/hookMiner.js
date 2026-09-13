import { logger } from "../logger.js";
import { createHumanBrowser, humanScroll, sleep, gaussianDelay, randDelay } from "./browser.js";

const SEARCH_URL = "https://www.tiktok.com/search?q=";
const PAGE_TIMEOUT_MS = 45_000;

const VIDEO_URL_PATTERN = /\/@([\w.-]+)\/video\/(\d+)/;

export function parseVideoUrl(url = "") {
  const match = String(url).match(VIDEO_URL_PATTERN);
  if (!match) return null;
  return { author: match[1], videoId: match[2] };
}

const METRIC_PATTERN = /([\d.,]+)\s*(mil|mi|k|m)?/;
const METRIC_MULTIPLIERS = { k: 1_000, mil: 1_000, m: 1_000_000, mi: 1_000_000 };

export function parseMetricNumber(raw = "") {
  const match = String(raw).toLowerCase().trim().match(METRIC_PATTERN);
  if (!match) return 0;

  const [, digits, suffix] = match;
  const multiplier = suffix ? METRIC_MULTIPLIERS[suffix] : 1;

  const normalized = multiplier === 1 ? digits.replace(/[.,]/g, "") : digits.replace(",", ".");

  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) return 0;

  return Math.round(num * multiplier);
}

function extractCandidates() {
  const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
  const results = [];

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/\/@([\w.-]+)\/video\/(\d+)/);
    if (!match) continue;

    let card = anchor;
    let caption = "";
    let viewsRaw = "";

    for (let i = 0; i < 6 && card; i++) {
      const isCardBoundary = card.querySelectorAll('a[href*="/video/"]').length === 1;
      if (isCardBoundary) {
        caption = card.querySelector('[data-e2e="search-card-video-caption"]')?.textContent?.trim() || caption;
        viewsRaw = card.querySelector('[data-e2e="video-views"]')?.textContent?.trim() || viewsRaw;
      }
      if (caption && viewsRaw) break;
      card = card.parentElement;
    }

    results.push({
      videoUrl: href.startsWith("http") ? href : `https://www.tiktok.com${href}`,
      caption,
      author: match[1],
      viewsRaw,
    });
  }

  return results;
}

export async function discoverCandidates(page, niche, { limit = 12, scrollRounds = 3 } = {}) {
  const term = `${niche} tiktok shop`;
  logger.info(`studio hookMiner: buscando "${term}"`);

  await page.goto(`${SEARCH_URL}${encodeURIComponent(term)}`, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_TIMEOUT_MS,
  });

  await sleep(gaussianDelay(3500, 900, 1500, 7000));

  try {
    await page.waitForSelector('[data-e2e="search-card-video-caption"]', { timeout: 20_000 });
  } catch {
    logger.warn("studio hookMiner: nenhum card de vídeo apareceu na busca — layout mudou ou houve bloqueio");
    return [];
  }

  for (let round = 0; round < scrollRounds; round++) {
    await humanScroll(page, randDelay(900, 1600), randDelay(6, 12));
    await sleep(gaussianDelay(1800, 600, 700, 4000));
  }

  const raw = await page.evaluate(extractCandidates);

  const seen = new Set();
  const candidates = [];

  for (const item of raw) {
    const parsed = parseVideoUrl(item.videoUrl);
    if (!parsed || seen.has(parsed.videoId)) continue;
    seen.add(parsed.videoId);

    candidates.push({
      videoId: parsed.videoId,
      videoUrl: item.videoUrl,
      caption: item.caption,
      author: item.author || parsed.author,
      views: parseMetricNumber(item.viewsRaw),
      niche,
    });
  }

  candidates.sort((a, b) => b.views - a.views);

  logger.info(`studio hookMiner: ${candidates.length} candidatos únicos para "${niche}"`);

  return candidates.slice(0, limit);
}

export async function withMinerBrowser(fn, { headless = true, requireSession = true } = {}) {
  const { browser, page, sessionApplied } = await createHumanBrowser({ headless, useSession: true });

  try {
    if (requireSession && !sessionApplied) {
      throw new Error(
        "Sem sessão da conta de mineração. A busca do TikTok não responde a acesso anônimo — rode `npm run studio:login` e faça login na conta de mineração antes.",
      );
    }

    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}
