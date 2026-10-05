import type { NextFunction, Request, Response } from "express";
import { GroupAccessError, NoGroupError } from "../modules/groups/groups.service";
import { isQuotaError, logError } from "../utils/errorLog";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // O app pediu um grupo que a pessoa não tem (saiu ou foi removida em outro
  // aparelho). Não é erro do servidor: o app volta pro grupo padrão.
  if (err instanceof GroupAccessError) {
    res.status(403).json({ error: "Você não faz mais parte desse grupo.", code: "group_access" });
    return;
  }
  // Rota de grupo chamada por quem ainda não tem grupo -- antes cada
  // controller repetia esse mesmo if.
  if (err instanceof NoGroupError) {
    res.status(404).json({ error: "no group yet" });
    return;
  }
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
