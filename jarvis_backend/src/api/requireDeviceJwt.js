import jwt from "jsonwebtoken";
import { logger } from "../logger.js";

export const API_SESSION_ID = "device";

export function requireDeviceJwt(req, res, next) {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    logger.error("API: JWT_SECRET ausente — todas as rotas autenticadas estão fechadas.");
    return res.status(500).json({ error: "JWT_SECRET não configurado no servidor." });
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ error: "Token ausente. Use Authorization: Bearer <token> de POST /auth/token." });
  }

  try {
    const payload = jwt.verify(token, secret);
    req.sessionId = payload.sub;
    return next();
  } catch {
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}
