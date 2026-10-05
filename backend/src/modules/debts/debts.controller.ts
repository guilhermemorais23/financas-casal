import type { Request, Response } from "express";
import { isValidMonthParam } from "../../utils/month";
import { NoGroupError } from "../groups/groups.service";
import {
  DebtNotFoundError,
  ForbiddenError,
  InstallmentNotFoundError,
  createDebt,
  listDebts,
  removeDebt,
  setInstallmentPaidForUser,
  updateDebtForUser,
  updateInstallmentMonth,
  type DebtScope,
} from "./debts.service";
import { isNonEmptyString, isValidAmount } from "../../utils/validation";


function isValidDueDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export async function createDebtHandler(req: Request, res: Response) {
  const { name, description, totalAmount, installmentsCount, scope, startMonth, dueDay } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    !isValidAmount(totalAmount) ||
    (installmentsCount !== undefined &&
      (typeof installmentsCount !== "number" || !Number.isInteger(installmentsCount) || installmentsCount < 1)) ||
    (scope !== undefined && scope !== "personal" && scope !== "joint") ||
    !isValidMonthParam(startMonth) ||
    (dueDay !== undefined && dueDay !== null && !isValidDueDay(dueDay))
  ) {
    res.status(400).json({
      error:
        "name, totalAmount and startMonth (YYYY-MM) are required; installmentsCount must be a positive integer; dueDay (if set) must be 1-31",
    });
    return;
  }

  const debt = await createDebt(req.user!.id, {
    name: name.trim(),
    description: isNonEmptyString(description) ? description.trim() : null,
    totalAmount,
    installmentsCount: installmentsCount ?? 1,
    scope: (scope as DebtScope) ?? "personal",
    startMonth,
    dueDay: dueDay ?? null,
  });
  res.status(201).json(debt);
}

export async function listDebtsHandler(req: Request, res: Response) {
  const debts = await listDebts(req.user!.id);
  res.status(200).json(debts);
}

export async function setInstallmentPaidHandler(req: Request, res: Response) {
  const { isPaid, referenceMonth } = req.body ?? {};
  if (typeof isPaid !== "boolean" && !isValidMonthParam(referenceMonth)) {
    res.status(400).json({ error: "isPaid (boolean) or referenceMonth (YYYY-MM) is required" });
    return;
  }

  try {
    const installment =
      typeof isPaid === "boolean"
        ? await setInstallmentPaidForUser(req.user!.id, req.params.debtId, req.params.installmentId, isPaid)
        : await updateInstallmentMonth(req.user!.id, req.params.debtId, req.params.installmentId, referenceMonth);
    res.status(200).json(installment);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof DebtNotFoundError || err instanceof InstallmentNotFoundError) {
      res.status(404).json({ error: "debt or installment not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this debt" });
      return;
    }
    throw err;
  }
}

export async function updateDebtHandler(req: Request, res: Response) {
  const { name, description, dueDay } = req.body ?? {};

  if (!isNonEmptyString(name) || (dueDay !== undefined && dueDay !== null && !isValidDueDay(dueDay))) {
    res.status(400).json({ error: "name is required; dueDay (if set) must be 1-31" });
    return;
  }

  try {
    const debt = await updateDebtForUser(req.user!.id, req.params.id, {
      name: name.trim(),
      description: isNonEmptyString(description) ? description.trim() : null,
      dueDay: dueDay !== undefined ? dueDay : undefined,
    });
    res.status(200).json(debt);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof DebtNotFoundError) {
      res.status(404).json({ error: "debt not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this debt" });
      return;
    }
    throw err;
  }
}

export async function deleteDebtHandler(req: Request, res: Response) {
  try {
    await removeDebt(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof DebtNotFoundError) {
      res.status(404).json({ error: "debt not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this debt" });
      return;
    }
    throw err;
  }
}
