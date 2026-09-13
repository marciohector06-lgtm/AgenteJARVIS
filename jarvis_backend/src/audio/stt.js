import { logger } from "../logger.js";
import { MODEL_FALLBACK_CHAIN, isQuotaError } from "../agent/modelFallback.js";

const TRANSCRIPTION_PROMPT =
  "Transcreva exatamente o que é dito neste áudio, em português do Brasil. " +
  "Responda apenas com a transcrição, sem comentários, sem aspas e sem descrever o áudio. " +
  "Se não houver fala audível, responda com uma string vazia.";

async function transcribeWithGemini(audioBuffer, mimeType) {
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: TRANSCRIPTION_PROMPT },
          { inline_data: { mime_type: mimeType, data: Buffer.from(audioBuffer).toString("base64") } },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 1024 },
  };

  let lastError;

  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const model = MODEL_FALLBACK_CHAIN[i];

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      );

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const error = new Error(`Gemini respondeu ${response.status}: ${detail.slice(0, 160)}`);
        error.status = response.status;
        throw error;
      }

      const payload = await response.json();
      return (payload.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    } catch (error) {
      lastError = error;
      const isLast = i === MODEL_FALLBACK_CHAIN.length - 1;

      if (!isLast && (isQuotaError(error) || error.status >= 500)) {
        logger.warn(`stt: "${model}" falhou (${error.message.slice(0, 60)}) — tentando o próximo`);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function transcribeWithWhisper(audioBuffer, mimeType) {
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), "audio");
  formData.append("model", "whisper-1");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Whisper API respondeu ${response.status}: ${errorText}`);
  }

  const { text } = await response.json();
  return text;
}

export async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  if (process.env.GEMINI_API_KEY) {
    return transcribeWithGemini(audioBuffer, mimeType);
  }

  if (process.env.OPENAI_API_KEY) {
    logger.info("stt: sem GEMINI_API_KEY, usando Whisper");
    return transcribeWithWhisper(audioBuffer, mimeType);
  }

  throw new Error(
    "Transcrição de áudio (STT) não configurada: defina GEMINI_API_KEY (preferido) ou OPENAI_API_KEY no .env do jarvis_backend.",
  );
}
