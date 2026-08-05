import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidCapAmountError,
  InvalidMonthError,
  getCurrentBudget,
  setCurrentBudget,
} from "./budgets.service";

function monthParam(req: Request): string | undefined {
  const value = req.query.month;
  return typeof value === "string" ? value : undefined;
}

export async function getCurrentBudgetHandler(req: Request, res: Response) {
  try {
    const result = await getCurrentBudget(req.user!.id, monthParam(req));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "invalid month" });
      return;
    }
    throw err;
  }
}

export async function setCurrentBudgetHandler(req: Request, res: Response) {
  const { capAmount } = req.body ?? {};
  if (typeof capAmount !== "number" || capAmount <= 0) {
    res.status(400).json({ error: "capAmount is required" });
    return;
  }

  try {
    const budget = await setCurrentBudget(req.user!.id, capAmount, monthParam(req));
    res.status(200).json(budget);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    if (err instanceof InvalidMonthError || err instanceof InvalidCapAmountError) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    throw err;
  }
}
