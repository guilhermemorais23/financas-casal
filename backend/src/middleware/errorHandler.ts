import type { NextFunction, Request, Response } from "express";
import { logError } from "../utils/errorLog";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  console.error(err);
  logError("http", err, { path: req.path, method: req.method, userId: req.user?.id });
  const body: { error: string; detail?: string } = { error: "Internal server error" };
  if (process.env.NODE_ENV !== "production") {
    body.detail = err instanceof Error ? err.message : String(err);
  }
  res.status(500).json(body);
}
