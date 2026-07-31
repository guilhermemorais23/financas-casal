import type { Request, Response } from "express";
import { NoCoupleError } from "../couples/couples.service";
import {
  InvalidAccountError,
  InvalidCategoryError,
  InvalidPayerError,
  UnsupportedSplitTypeError,
  createExpense,
  getBalance,
  listTransactions,
} from "./transactions.service";
import type { SplitType } from "./transactions.repository";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createTransactionHandler(req: Request, res: Response) {
  const { accountId, categoryId, payerId, description, amount, occurredAt, isPrivate, splitType } =
    req.body ?? {};

  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(payerId) ||
    !isNonEmptyString(description) ||
    !isNonEmptyString(occurredAt) ||
    typeof amount !== "number" ||
    amount <= 0
  ) {
    res.status(400).json({ error: "accountId, payerId, description, amount and occurredAt are required" });
    return;
  }

  try {
    const transaction = await createExpense(req.user!.id, {
      accountId,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      payerId,
      description: description.trim(),
      amount,
      occurredAt,
      isPrivate: Boolean(isPrivate),
      splitType: (splitType as SplitType) ?? "none",
    });
    res.status(201).json(transaction);
  } catch (err) {
    if (err instanceof NoCoupleError) {
      res.status(404).json({ error: "no couple yet" });
      return;
    }
    if (
      err instanceof InvalidAccountError ||
      err instanceof InvalidPayerError ||
      err instanceof InvalidCategoryError ||
      err instanceof UnsupportedSplitTypeError
    ) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    throw err;
  }
}

export async function listTransactionsHandler(req: Request, res: Response) {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  try {
    const transactions = await listTransactions(req.user!.id, limit);
    res.status(200).json(transactions);
  } catch (err) {
    if (err instanceof NoCoupleError) {
      res.status(404).json({ error: "no couple yet" });
      return;
    }
    throw err;
  }
}

export async function getBalanceHandler(req: Request, res: Response) {
  try {
    const balance = await getBalance(req.user!.id);
    res.status(200).json(balance);
  } catch (err) {
    if (err instanceof NoCoupleError) {
      res.status(404).json({ error: "no couple yet" });
      return;
    }
    throw err;
  }
}
