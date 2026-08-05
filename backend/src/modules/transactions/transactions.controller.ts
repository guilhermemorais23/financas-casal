import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidAccountError,
  InvalidCategoryError,
  InvalidMonthError,
  InvalidPayerError,
  TransactionNotFoundError,
  UnsupportedSplitTypeError,
  createTransaction,
  deleteTransactionForUser,
  getBalance,
  getMonthlySummaryForUser,
  listTransactions,
  updateTransactionForUser,
} from "./transactions.service";
import type { SplitType, TransactionType } from "./transactions.repository";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createTransactionHandler(req: Request, res: Response) {
  const {
    accountId,
    categoryId,
    payerId,
    description,
    amount,
    transactionType,
    occurredAt,
    isPrivate,
    splitType,
  } = req.body ?? {};

  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(payerId) ||
    !isNonEmptyString(description) ||
    !isNonEmptyString(occurredAt) ||
    typeof amount !== "number" ||
    amount <= 0 ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income")
  ) {
    res.status(400).json({
      error: "accountId, payerId, description, amount and occurredAt are required",
    });
    return;
  }

  try {
    const transaction = await createTransaction(req.user!.id, {
      accountId,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      payerId,
      description: description.trim(),
      amount,
      transactionType: (transactionType as TransactionType) ?? "expense",
      occurredAt,
      isPrivate: Boolean(isPrivate),
      splitType: (splitType as SplitType) ?? "none",
    });
    res.status(201).json(transaction);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
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
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  try {
    const transactions = await listTransactions(req.user!.id, limit, month, accountId);
    res.status(200).json(transactions);
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

export async function getBalanceHandler(req: Request, res: Response) {
  try {
    const balance = await getBalance(req.user!.id);
    res.status(200).json(balance);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function getSummaryHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;

  try {
    const summary = await getMonthlySummaryForUser(req.user!.id, month);
    res.status(200).json(summary);
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

export async function updateTransactionHandler(req: Request, res: Response) {
  const { description, amount, transactionType, categoryId, occurredAt } = req.body ?? {};

  if (
    (description !== undefined && !isNonEmptyString(description)) ||
    (amount !== undefined && (typeof amount !== "number" || amount <= 0)) ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income") ||
    (occurredAt !== undefined && !isNonEmptyString(occurredAt)) ||
    (categoryId !== undefined && categoryId !== null && !isNonEmptyString(categoryId))
  ) {
    res.status(400).json({ error: "invalid transaction update" });
    return;
  }

  try {
    const transaction = await updateTransactionForUser(req.user!.id, req.params.id, {
      description: description !== undefined ? description.trim() : undefined,
      amount,
      transactionType: transactionType as TransactionType | undefined,
      categoryId,
      occurredAt,
    });
    res.status(200).json(transaction);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "transaction not found" });
      return;
    }
    if (err instanceof InvalidCategoryError) {
      res.status(400).json({ error: "InvalidCategoryError" });
      return;
    }
    throw err;
  }
}

export async function deleteTransactionHandler(req: Request, res: Response) {
  try {
    await deleteTransactionForUser(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "transaction not found" });
      return;
    }
    throw err;
  }
}
