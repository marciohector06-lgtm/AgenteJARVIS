import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { CAPTION_DIR, ensureStudioDirs } from "./paths.js";

const MAX_WORDS_PER_CUE = 3;
const MAX_CHARS_PER_CUE = 20;
const MIN_CUE_SECONDS = 0.25;

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sodre,Arial,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,80,80,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

function formatTimestamp(seconds) {
  const total = Math.max(Number(seconds) || 0, 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  const centis = Math.round((total - Math.floor(total)) * 100);
  const safeCentis = Math.min(centis, 99);

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(safeCentis).padStart(2, "0")}`;
}

function escapeAssText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, " ");
}

export function groupWordsIntoCues(words) {
  const cues = [];
  let current = null;

  for (const word of words) {
    if (!word?.text) continue;

    const wouldExceed =
      current &&
      (current.words.length >= MAX_WORDS_PER_CUE ||
        `${current.text} ${word.text}`.length > MAX_CHARS_PER_CUE);

    if (!current || wouldExceed) {
      if (current) cues.push(current);
      current = { text: word.text, words: [word], start: word.start, end: word.end };
      continue;
    }

    current.text = `${current.text} ${word.text}`;
    current.words.push(word);
    current.end = word.end;
  }

  if (current) cues.push(current);

  return cues.map((cue, index) => {
    const next = cues[index + 1];
    const minEnd = cue.start + MIN_CUE_SECONDS;
    let end = Math.max(cue.end, minEnd);
    if (next && end > next.start) end = next.start;
    return { text: cue.text, start: cue.start, end: Math.max(end, cue.start + 0.05) };
  });
}

export function buildAss(words) {
  const cues = groupWordsIntoCues(words);

  const events = cues
    .map((cue) => `Dialogue: 0,${formatTimestamp(cue.start)},${formatTimestamp(cue.end)},Sodre,,0,0,0,,${escapeAssText(cue.text.toUpperCase())}`)
    .join("\n");

  return `${ASS_HEADER}${events}\n`;
}

export function writeCaptionFile(words, videoId) {
  if (!Array.isArray(words) || words.length === 0) return null;

  ensureStudioDirs();

  const captionPath = join(CAPTION_DIR, `captions_${videoId}.ass`);
  writeFileSync(captionPath, buildAss(words), "utf8");

  return captionPath;
}
