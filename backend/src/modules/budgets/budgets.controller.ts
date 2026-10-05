import type { Request, Response } from "express";
import {
  InvalidCapAmountError,
  InvalidCategoryError,
  InvalidMonthError,
  getCategoryBudgets,
  getCurrentBudget,
  setCategoryBudget,
  setCurrentBudget,
} from "./budgets.service";
import { isValidAmount } from "../../utils/validation";

function monthParam(req: Request): string | undefined {
  const value = req.query.month;
  return typeof value === "string" ? value : undefined;
}

export async function getCurrentBudgetHandler(req: Request, res: Response) {
  try {
    const result = await getCurrentBudget(req.user!.id, monthParam(req));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "invalid month" });
      return;
    }
    throw err;
  }
}

export async function setCurrentBudgetHandler(req: Request, res: Response) {
  const { capAmount } = req.body ?? {};
  if (!isValidAmount(capAmount)) {
    res.status(400).json({ error: "capAmount is required" });
    return;
  }

  try {
    const budget = await setCurrentBudget(req.user!.id, capAmount, monthParam(req));
    res.status(200).json(budget);
  } catch (err) {
    if (err instanceof InvalidMonthError || err instanceof InvalidCapAmountError) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    throw err;
  }
}

export async function getCategoryBudgetsHandler(req: Request, res: Response) {
  try {
    const result = await getCategoryBudgets(req.user!.id, monthParam(req));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "invalid month" });
      return;
    }
    throw err;
  }
}

export async function setCategoryBudgetHandler(req: Request, res: Response) {
  const { capAmount } = req.body ?? {};
  if (capAmount !== null && !isValidAmount(capAmount)) {
    res.status(400).json({ error: "capAmount must be a positive number or null" });
    return;
  }

  try {
    const result = await setCategoryBudget(req.user!.id, req.params.categoryId, capAmount, monthParam(req));
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidCategoryError) {
      res.status(400).json({ error: "invalid category" });
      return;
    }
    if (err instanceof InvalidMonthError || err instanceof InvalidCapAmountError) {
      res.status(400).json({ error: "invalid request" });
      return;
    }
    throw err;
  }
}
