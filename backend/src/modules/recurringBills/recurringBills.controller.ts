import type { Request, Response } from "express";
import {
  InvalidAccountError,
  InvalidCategoryError,
  InvalidPayerError,
  UnsupportedSplitTypeError,
} from "../transactions/transactions.service";
import type { SplitType, TransactionType } from "../transactions/transactions.repository";
import {
  BillAlreadyPaidError,
  InvalidBillAmountError,
  InvalidDayOfMonthError,
  RecurringBillNotFoundError,
  createRecurringBillForUser,
  deleteRecurringBillForUser,
  isAmountMode,
  isRemindDays,
  isValidDayOfMonth,
  listBillRemindersForUser,
  listRecurringBillsForUser,
  payBillForUser,
  snoozeBillForUser,
  updateRecurringBillForUser,
  type SnoozeChoice,
} from "./recurringBills.service";
import { isValidMonthParam } from "../../utils/month";
import { isIsoDate, isNonEmptyString, isValidAmount } from "../../utils/validation";

export async function createRecurringBillHandler(req: Request, res: Response) {
  const {
    accountId,
    categoryId,
    payerId,
    description,
    amount,
    amountMode,
    remindDaysBefore,
    transactionType,
    isPrivate,
    splitType,
    dayOfMonth,
  } = req.body ?? {};

  const mode = amountMode ?? "fixed";
  if (
    !isNonEmptyString(accountId) ||
    !isNonEmptyString(payerId) ||
    !isNonEmptyString(description) ||
    !isAmountMode(mode) ||
    // "Não sei ainda" vem sem valor; os outros dois precisam de um.
    (mode === "unknown" ? amount !== undefined && amount !== null && !isValidAmount(amount) : !isValidAmount(amount)) ||
    (remindDaysBefore !== undefined && !isRemindDays(remindDaysBefore)) ||
    !isValidDayOfMonth(dayOfMonth) ||
    (transactionType !== undefined && transactionType !== "expense" && transactionType !== "income") ||
    (splitType !== undefined && splitType !== "none" && splitType !== "equal")
  ) {
    res.status(400).json({
      error: "accountId, payerId, description, amount (a não ser sem valor) and dayOfMonth (1-31) are required",
    });
    return;
  }

  try {
    const bill = await createRecurringBillForUser(req.user!.id, {
      accountId,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      payerId,
      description: description.trim(),
      amount: mode === "unknown" ? null : amount,
      amountMode: mode,
      remindDaysBefore,
      transactionType: (transactionType as TransactionType) ?? "expense",
      isPrivate: Boolean(isPrivate),
      splitType: (splitType as SplitType) ?? "none",
      dayOfMonth,
    });
    res.status(201).json(bill);
  } catch (err) {
    if (
      err instanceof InvalidAccountError ||
      err instanceof InvalidPayerError ||
      err instanceof InvalidCategoryError ||
      err instanceof UnsupportedSplitTypeError ||
      err instanceof InvalidDayOfMonthError ||
      err instanceof InvalidBillAmountError
    ) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    throw err;
  }
}

export async function listRecurringBillsHandler(req: Request, res: Response) {
  res.status(200).json(await listRecurringBillsForUser(req.user!.id));
}

// Avisos do Painel (?all=1: a lista "Contas do mês").
export async function listBillRemindersHandler(req: Request, res: Response) {
  res.status(200).json(await listBillRemindersForUser(req.user!.id, { includeAll: req.query.all === "1" }));
}

export async function updateRecurringBillHandler(req: Request, res: Response) {
  const { description, amount, amountMode, remindDaysBefore, dayOfMonth, categoryId, isActive } = req.body ?? {};

  if (
    (description !== undefined && !isNonEmptyString(description)) ||
    (amount !== undefined && amount !== null && !isValidAmount(amount)) ||
    (amountMode !== undefined && !isAmountMode(amountMode)) ||
    (remindDaysBefore !== undefined && !isRemindDays(remindDaysBefore)) ||
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
      amountMode,
      remindDaysBefore,
      dayOfMonth,
      categoryId,
      isActive,
    });
    res.status(200).json(bill);
  } catch (err) {
    if (err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
      return;
    }
    if (err instanceof InvalidDayOfMonthError || err instanceof InvalidBillAmountError) {
      res.status(400).json({ error: "invalid recurring bill update" });
      return;
    }
    throw err;
  }
}

// "Já paguei" de uma conta sem valor certo.
export async function payBillHandler(req: Request, res: Response) {
  const { month, amount, markOnly, occurredAt } = req.body ?? {};
  if (
    !isValidMonthParam(month) ||
    (markOnly !== undefined && typeof markOnly !== "boolean") ||
    (markOnly !== true && !isValidAmount(amount)) ||
    (occurredAt !== undefined && !isIsoDate(occurredAt))
  ) {
    res.status(400).json({ error: "Informe quanto foi a conta." });
    return;
  }
  try {
    res.status(200).json(
      await payBillForUser(req.user!.id, req.params.id, {
        month,
        amount: markOnly === true ? undefined : amount,
        markOnly: markOnly === true,
        occurredAt,
      })
    );
  } catch (err) {
    if (err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
      return;
    }
    if (err instanceof BillAlreadyPaidError) {
      res.status(409).json({ error: "Essa conta já foi marcada como paga.", code: "already_paid" });
      return;
    }
    if (err instanceof InvalidBillAmountError) {
      res.status(400).json({ error: "Informe quanto foi a conta." });
      return;
    }
    throw err;
  }
}

const SNOOZE_CHOICES: SnoozeChoice[] = ["tomorrow", "due", "salary"];

// "Me lembre mais tarde".
export async function snoozeBillHandler(req: Request, res: Response) {
  const { until } = req.body ?? {};
  if (!SNOOZE_CHOICES.includes(until)) {
    res.status(400).json({ error: "until must be tomorrow, due or salary" });
    return;
  }
  try {
    res.status(200).json(await snoozeBillForUser(req.user!.id, req.params.id, until));
  } catch (err) {
    if (err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
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
    if (err instanceof RecurringBillNotFoundError) {
      res.status(404).json({ error: "recurring bill not found" });
      return;
    }
    throw err;
  }
}
