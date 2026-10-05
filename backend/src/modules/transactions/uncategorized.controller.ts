import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { currentMonthParam } from "../../utils/month";
import { InvalidCategorizeError, categorizeTransactions, listUncategorized } from "./uncategorized";

export async function listUncategorizedHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : currentMonthParam();
  try {
    res.json(await listUncategorized(req.user!.id, month));
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function categorizeHandler(req: Request, res: Response) {
  try {
    res.json(await categorizeTransactions(req.user!.id, req.body ?? {}));
  } catch (err) {
    if (err instanceof InvalidCategorizeError) {
      res.status(400).json({ error: "Escolha uma categoria e os lançamentos." });
      return;
    }
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}
