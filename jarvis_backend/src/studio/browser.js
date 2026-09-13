import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { logger } from "../logger.js";
import { applySession } from "./session.js";

const SYSTEM_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
];

export function findSystemChrome() {
  return SYSTEM_CHROME_PATHS.find((path) => existsSync(path)) || null;
}

const LAUNCH_TIMEOUT_MS = 90_000;
const PROTOCOL_TIMEOUT_MS = 180_000;

const FINGERPRINTS = [
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
  },
  {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
  },
  {
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  },
];

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function gaussianDelay(meanMs, stdMs = meanMs * 0.3, minMs = 200, maxMs = meanMs * 3) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(Math.max(meanMs + normal * stdMs, minMs), maxMs);
}

export function randDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

const ANTI_DETECTION = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  Object.defineProperty(navigator, "plugins", {
    get: () => [{ name: "Chrome PDF Plugin" }, { name: "Chrome PDF Viewer" }, { name: "Native Client" }],
  });
  Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
  delete window.__puppeteer_evaluation_script__;
};

export async function createHumanBrowser({ headless = true, useSession = false, executablePath = null } = {}) {
  const fingerprint = FINGERPRINTS[Math.floor(Math.random() * FINGERPRINTS.length)];

  const browser = await puppeteer.launch({
    headless,
    timeout: LAUNCH_TIMEOUT_MS,
    protocolTimeout: PROTOCOL_TIMEOUT_MS,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--lang=pt-BR",
      `--window-size=${fingerprint.viewport.width},${fingerprint.viewport.height}`,
    ],
  });

  const page = await browser.newPage();

  await page.setUserAgent(fingerprint.userAgent);
  await page.setViewport({
    width: fingerprint.viewport.width,
    height: fingerprint.viewport.height,
    deviceScaleFactor: fingerprint.deviceScaleFactor,
  });
  await page.setExtraHTTPHeaders({
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
  });
  await page.evaluateOnNewDocument(ANTI_DETECTION);

  logger.info(`studio browser: fingerprint ${fingerprint.userAgent.slice(0, 48)}... ${fingerprint.viewport.width}x${fingerprint.viewport.height}`);

  const sessionApplied = useSession ? await applySession(page) : false;

  if (useSession && !sessionApplied) {
    logger.warn("studio browser: nenhuma sessão de mineração salva — rode `npm run studio:login` antes de minerar");
  }

  return { browser, page, fingerprint, sessionApplied };
}

export async function humanScroll(page, totalPx = 1200, steps = 10) {
  const stepPx = Math.round(totalPx / steps);

  for (let i = 0; i < steps; i++) {
    const jitter = randDelay(-Math.round(stepPx * 0.2), Math.round(stepPx * 0.2));
    await page.mouse.wheel({ deltaY: stepPx + jitter });
    await sleep(gaussianDelay(220, 90, 60, 700));

    if (Math.random() < 0.15) {
      await page.mouse.wheel({ deltaY: -randDelay(40, 140) });
      await sleep(gaussianDelay(400, 150, 120, 1200));
    }
  }
}

export async function humanMove(page, x, y) {
  await page.mouse.move(x, y, { steps: randDelay(8, 20) });
  await sleep(gaussianDelay(180, 70, 50, 600));
}
