import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidAccountError,
  InvalidCategoryError,
  InvalidPayerError,
  UnsupportedSplitTypeError,
} from "../transactions/transactions.service";
import type { SplitType, TransactionType } from "../transactions/transactions.repository";
import {
  InvalidDayOfMonthError,
  RecurringBillNotFoundError,
  createRecurringBillForUser,
  deleteRecurringBillForUser,
  listRecurringBillsForUser,
  updateRecurringBillForUser,
} from "./recurringBills.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDayOfMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export async function createRecurringBillHandler(req: Request, res: Response) {
  const { accountId, categoryId, payerId, description, amount, transactionType, isPrivate, splitType, dayOfMonth } =
    req.body ?? {};

  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(payerId) ||
    !isNonEmptyString(description) ||
    typeof amount !== "number" ||
    amount <= 0 ||
    !isValidDayOfMonth(dayOfMonth) ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income") ||
    (splitType !== undefined && splitType !== "none" && splitType !== "equal")
  ) {
    res.status(400).json({
      error: "accountId, payerId, description, amount and dayOfMonth (1-31) are required",
    });
    return;
  }

  try {
    const bill = await createRecurringBillForUser(req.user!.id, {
      accountId,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      payerId,
      description: description.trim(),
      amount,
      transactionType: (transactionType as TransactionType) ?? "expense",
      isPrivate: Boolean(isPrivate),
      splitType: (splitType as SplitType) ?? "none",
      dayOfMonth,
    });
    res.status(201).json(bill);
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
      err instanceof InvalidDayOfMonthError
    ) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    throw err;
  }
}

export async function listRecurringBillsHandler(req: Request, res: Response) {
  try {
    const bills = await listRecurringBillsForUser(req.user!.id);
    res.status(200).json(bills);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function updateRecurringBillHandler(req: Request, res: Response) {
  const { description, amount, dayOfMonth, categoryId, isActive } = req.body ?? {};

  if (
    (description !== undefined && !isNonEmptyString(description)) ||
    (amount !== undefined && (typeof amount !== "number" || amount <= 0)) ||
    (dayOfMonth !== undefined && !isValidDayOfMonth(dayOfMonth)) ||
    (isActive !== undefined && typeof isActive !== "boolean") ||
    (categoryId !== undefined && categoryId !== null && !isNonEmptyString(categoryId))
  ) {
    res.status(400).json({ error: "invalid recurring bill update" });
    return;
  }

  try {
    const bill = await updateRecurringBillForUser(req.user!.id, req.params.id, {
      description: description !== undefined ? description.trim() : undefined,
      amount,
      dayOfMonth,
      categoryId,
      isActive,
    });
    res.status(200).json(bill);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
      return;
    }
    if (err instanceof InvalidDayOfMonthError) {
      res.status(400).json({ error: "invalid recurring bill update" });
      return;
    }
    throw err;
  }
}

export async function deleteRecurringBillHandler(req: Request, res: Response) {
  try {
    await deleteRecurringBillForUser(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
      return;
    }
    throw err;
  }
}
