import Database from "better-sqlite3";

export const db = new Database(process.env.SQLITE_PATH || "./jarvis.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS offers (
    id TEXT PRIMARY KEY,
    productName TEXT NOT NULL,
    category TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    commission REAL NOT NULL DEFAULT 0,
    hashtags TEXT NOT NULL DEFAULT '[]',
    active INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    offerId TEXT NOT NULL,
    state TEXT NOT NULL,
    baseVideoPath TEXT,
    scriptJson TEXT,
    hookFormula TEXT,
    sceneFormat TEXT,
    audioPath TEXT,
    videoPath TEXT,
    postedUrl TEXT,
    lastError TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_videos_state ON videos(state);
  CREATE INDEX IF NOT EXISTS idx_videos_offerId ON videos(offerId);

  CREATE TABLE IF NOT EXISTS hooks_mined (
    id TEXT PRIMARY KEY,
    niche TEXT NOT NULL,
    sourceUrl TEXT NOT NULL,
    transcript TEXT NOT NULL,
    formula TEXT,
    mechanism TEXT,
    gripScore REAL,
    rationale TEXT,
    views INTEGER NOT NULL DEFAULT 0,
    minedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_hooks_mined_niche ON hooks_mined(niche);

  CREATE TABLE IF NOT EXISTS hook_results (
    id TEXT PRIMARY KEY,
    videoId TEXT NOT NULL,
    hookText TEXT NOT NULL,
    hookFormula TEXT,
    sceneFormat TEXT,
    decision TEXT,
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    measuredAt INTEGER,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_hook_results_videoId ON hook_results(videoId);
  CREATE INDEX IF NOT EXISTS idx_hook_results_formula ON hook_results(hookFormula);
`);
