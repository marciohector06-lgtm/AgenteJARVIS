export function normalizeWhatsappNumber(raw) {
  return String(raw || "").replace(/\D/g, "");
}

export function toWhatsappJid(number) {
  return `${normalizeWhatsappNumber(number)}@c.us`;
}

export function getAllowedWhatsappNumbers() {
  return String(process.env.ALLOWED_WHATSAPP_NUMBERS || "")
    .split(",")
    .map(normalizeWhatsappNumber)
    .filter(Boolean);
}

export function getWhatsappOwnerNumber() {
  return normalizeWhatsappNumber(process.env.WHATSAPP_OWNER_NUMBER);
}

export function isAllowedWhatsappNumber(rawNumber) {
  const number = normalizeWhatsappNumber(rawNumber);
  if (!number) return false;
  const owner = getWhatsappOwnerNumber();
  return getAllowedWhatsappNumbers().includes(number) || (Boolean(owner) && number === owner);
}
