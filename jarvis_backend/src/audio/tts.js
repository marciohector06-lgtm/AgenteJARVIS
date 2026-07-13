const MAX_CHUNK_LENGTH = 200;
const TTS_LANG = "pt-BR";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function splitIntoChunks(text, maxLength) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt <= 0) splitAt = maxLength;

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }

  return chunks;
}

async function fetchChunkAudio(chunk) {
  const url = new URL("https://translate.google.com/translate_tts");
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("q", chunk);
  url.searchParams.set("tl", TTS_LANG);
  url.searchParams.set("client", "tw-ob");

  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

  if (!response.ok) {
    throw new Error(`gTTS respondeu ${response.status} para o trecho: "${chunk.slice(0, 30)}..."`);
  }

  return Buffer.from(await response.arrayBuffer());
}

export async function textToSpeech(text) {
  const chunks = splitIntoChunks(text, MAX_CHUNK_LENGTH);
  const buffers = [];

  for (const chunk of chunks) {
    buffers.push(await fetchChunkAudio(chunk));
  }

  return Buffer.concat(buffers);
}
