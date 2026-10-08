import type { Request, Response } from "express";
import { currentMonthParam } from "../../utils/month";
import { InvalidCategorizeError, categorizeTransactions, listUncategorized } from "./uncategorized";
import { InvalidPaymentUpdateError, listWithoutPaymentMethod, setPaymentMethods } from "./paymentMethods";

export async function listUncategorizedHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : currentMonthParam();
  res.json(await listUncategorized(req.user!.id, month));
}

export async function categorizeHandler(req: Request, res: Response) {
  try {
    res.json(await categorizeTransactions(req.user!.id, req.body ?? {}));
  } catch (err) {
    if (err instanceof InvalidCategorizeError) {
      res.status(400).json({ error: "Escolha uma categoria e os lançamentos." });
      return;
    }
    throw err;
  }
}

// "Sem forma de pagamento" (Relatórios > organizar).
export async function listNoPaymentHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : currentMonthParam();
  res.json(await listWithoutPaymentMethod(req.user!.id, month));
}

export async function setPaymentMethodsHandler(req: Request, res: Response) {
  try {
    res.json(await setPaymentMethods(req.user!.id, req.body ?? {}));
  } catch (err) {
    if (err instanceof InvalidPaymentUpdateError) {
      res.status(400).json({ error: "Escolha a forma de pagamento e os lançamentos." });
      return;
    }
    throw err;
  }
}
