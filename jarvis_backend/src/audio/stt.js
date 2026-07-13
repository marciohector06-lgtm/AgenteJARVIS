export async function transcribeAudio(audioBuffer, mimeType = "audio/webm") {
  if (!process.env.OPENAI_API_KEY) {
    return "STT não configurado";
  }

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
