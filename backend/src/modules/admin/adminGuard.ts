import type { Request, Response } from "express";
import { NotAdminError, requireAdminEmail } from "./admin.service";

// Rotas de admin: responde 403 e devolve false pra quem não é admin.
export function ensureAdmin(req: Request, res: Response): boolean {
  try {
    requireAdminEmail(req.user!.email);
    return true;
  } catch (err) {
    if (err instanceof NotAdminError) {
      res.status(403).json({ error: "not an admin" });
      return false;
    }
    throw err;
  }
}
