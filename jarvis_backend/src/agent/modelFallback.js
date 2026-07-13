export const MODEL_FALLBACK_CHAIN = [
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
];

export function isQuotaError(error) {
  return error?.status === 429 || /quota|rate.?limit/i.test(error?.message || "");
}
