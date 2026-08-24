import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { InvalidMonthError } from "../../utils/month";
import { generateSpendingInsight, InsightNotConfiguredError } from "./insights.service";

export async function getInsightHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;

  try {
    const insight = await generateSpendingInsight(req.user!.id, month);
    res.status(200).json(insight);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "invalid month" });
      return;
    }
    if (err instanceof InsightNotConfiguredError) {
      res.status(503).json({ error: "análise por IA não configurada" });
      return;
    }
    throw err;
  }
}
