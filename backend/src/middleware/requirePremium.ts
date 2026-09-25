import type { NextFunction, Request, Response } from "express";
import { isPremiumUser } from "../modules/billing/billing.service";

// Recursos do Premium. Com a cobrança desligada (BILLING_ENABLED != true)
// deixa passar todo mundo. Responde 402 com code "premium_required", que o
// app transforma na janela "Isso é do Premium".
export async function requirePremium(req: Request, res: Response, next: NextFunction) {
  try {
    if (await isPremiumUser(req.user!.id)) {
      next();
      return;
    }
    res.status(402).json({ error: "Esse recurso faz parte do Premium.", code: "premium_required" });
  } catch (err) {
    next(err);
  }
}
