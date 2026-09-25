import type { NextFunction, Request, Response } from "express";
import { isQuotaError, logError } from "../utils/errorLog";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  logError("http", err, { path: req.path, method: req.method, userId: req.user?.id });
  if (isQuotaError(err)) {
    res.status(503).json({
      error: "O PAR. chegou no limite de uso do plano grátis por hoje. Volta a funcionar sozinho de madrugada (por volta das 4h). Seus dados estão guardados.",
      code: "quota",
    });
    return;
  }
  const body: { error: string; detail?: string } = { error: "Internal server error" };
  if (process.env.NODE_ENV !== "production") {
    body.detail = err instanceof Error ? err.message : String(err);
  }
  res.status(500).json(body);
}
