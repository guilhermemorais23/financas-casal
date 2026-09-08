import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { toCsv } from "../../utils/csv";
import {
  InvalidAccountError,
  InvalidCategoryError,
  InvalidMonthError,
  InvalidPayerError,
  InvalidRecurrenceError,
  InvalidRecurringUpdateError,
  InvalidSettlementAmountError,
  NotSplitError,
  TransactionNotFoundError,
  UnsupportedSplitTypeError,
  cancelRecurringForUser,
  createTransaction,
  deleteTransactionForUser,
  exportTransactionsForUser,
  getBalance,
  getDailySeriesForUser,
  getMonthlySummaryForUser,
  listTransactions,
  setSplitSettledForUser,
  updateRecurringForUser,
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
    recurringMonths,
  } = req.body ?? {};

  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(payerId) ||
    !isNonEmptyString(description) ||
    !isNonEmptyString(occurredAt) ||
    typeof amount !== "number" ||
    amount <= 0 ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income") ||
    (recurringMonths !== undefined && recurringMonths !== null && typeof recurringMonths !== "number")
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
      recurring: typeof recurringMonths === "number" ? { months: recurringMonths } : undefined,
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
      err instanceof UnsupportedSplitTypeError ||
      err instanceof InvalidRecurrenceError
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
  const scope = req.query.scope === "visible" ? "visible" : "joint";

  try {
    const summary = await getMonthlySummaryForUser(req.user!.id, month, scope);
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

export async function getDailySeriesHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  const scope = req.query.scope === "joint" ? "joint" : "visible";

  try {
    const points = await getDailySeriesForUser(req.user!.id, month, scope);
    res.status(200).json(points);
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

const CSV_HEADER = ["Data", "Descricao", "Categoria", "Tipo", "Valor", "Conta", "Privado"];

export async function exportTransactionsHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;

  try {
    const transactions = await exportTransactionsForUser(req.user!.id, month);
    const rows = transactions.map((tx) => [
      tx.occurredAt,
      tx.description,
      tx.categoryName ?? "Sem categoria",
      tx.transactionType === "income" ? "Receita" : "Despesa",
      tx.amount,
      tx.accountType === "joint" ? "Conjunta" : "Pessoal",
      tx.isPrivate ? "Sim" : "Nao",
    ]);
    const csv = toCsv([CSV_HEADER, ...rows]);
    const filename = `par-transacoes-${month ?? "todos"}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    // UTF-8 BOM so Excel (which otherwise guesses Latin-1) shows acentos right.
    res.status(200).send("﻿" + csv);
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
  const { description, amount, transactionType, categoryId, occurredAt, payerId, accountId } = req.body ?? {};

  if (
    (description !== undefined && !isNonEmptyString(description)) ||
    (amount !== undefined && (typeof amount !== "number" || amount <= 0)) ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income") ||
    (occurredAt !== undefined && !isNonEmptyString(occurredAt)) ||
    (categoryId !== undefined && categoryId !== null && !isNonEmptyString(categoryId)) ||
    (payerId !== undefined && !isNonEmptyString(payerId)) ||
    (accountId !== undefined && !isNonEmptyString(accountId))
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
      payerId,
      accountId,
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
    if (err instanceof InvalidAccountError) {
      res.status(400).json({ error: "InvalidAccountError" });
      return;
    }
    if (err instanceof InvalidPayerError) {
      res.status(400).json({ error: "InvalidPayerError" });
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

// Cancels a recurring series from this occurrence onward (this one + every
// future one); past occurrences stay in the ledger untouched.
export async function cancelRecurringHandler(req: Request, res: Response) {
  try {
    const result = await cancelRecurringForUser(req.user!.id, req.params.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "transaction not found" });
      return;
    }
    throw err;
  }
}

// Rewrites amount/description on this occurrence and every future one in
// the same recurring series (e.g. the rent went up) -- past occurrences are
// never touched.
export async function updateRecurringHandler(req: Request, res: Response) {
  const { amount, description } = req.body ?? {};
  if (
    (amount !== undefined && (typeof amount !== "number" || amount <= 0)) ||
    (description !== undefined && !isNonEmptyString(description))
  ) {
    res.status(400).json({ error: "invalid recurring update" });
    return;
  }

  try {
    const result = await updateRecurringForUser(req.user!.id, req.params.id, {
      amount,
      description: description !== undefined ? description.trim() : undefined,
    });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "transaction not found" });
      return;
    }
    if (err instanceof InvalidRecurringUpdateError) {
      res.status(400).json({ error: "invalid recurring update" });
      return;
    }
    throw err;
  }
}

// Marks a split expense as settled (someone paid their share back outside
// the app) or reopens it -- doesn't touch the transaction's amount.
export async function setSplitSettledHandler(req: Request, res: Response) {
  const { isSettled, amount } = req.body ?? {};
  if (typeof isSettled !== "boolean") {
    res.status(400).json({ error: "isSettled must be a boolean" });
    return;
  }
  // amount only matters (and is required) when settling -- reopening never
  // needs one, it just deletes the reembolso transaction created earlier.
  if (isSettled && (typeof amount !== "number" || amount <= 0)) {
    res.status(400).json({ error: "amount is required and must be a positive number when isSettled is true" });
    return;
  }

  try {
    const transaction = await setSplitSettledForUser(req.user!.id, req.params.id, isSettled, amount);
    res.status(200).json(transaction);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof TransactionNotFoundError) {
      res.status(404).json({ error: "transaction not found" });
      return;
    }
    if (err instanceof NotSplitError) {
      res.status(400).json({ error: "transaction is not split" });
      return;
    }
    if (err instanceof InvalidSettlementAmountError) {
      res.status(400).json({ error: "invalid amount" });
      return;
    }
    throw err;
  }
}
