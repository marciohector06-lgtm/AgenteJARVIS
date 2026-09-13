import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const STUDIO_ROOT = process.env.STUDIO_ROOT || "./studio-data";

export const STUDIO_ROOT_DIR = resolve(STUDIO_ROOT);
export const BASE_VIDEOS_DIR = resolve(STUDIO_ROOT, "base_videos");
export const AUDIO_DIR = resolve(STUDIO_ROOT, "audio");
export const VIDEO_DIR = resolve(STUDIO_ROOT, "videos");
export const CLIP_DIR = resolve(STUDIO_ROOT, "clips");

const ALL_DIRS = [STUDIO_ROOT_DIR, BASE_VIDEOS_DIR, AUDIO_DIR, VIDEO_DIR, CLIP_DIR];

export function ensureStudioDirs() {
  for (const dir of ALL_DIRS) {
    mkdirSync(dir, { recursive: true });
  }
}
