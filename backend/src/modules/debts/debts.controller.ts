import type { Request, Response } from "express";
import { isValidMonthParam } from "../../utils/month";
import { NoGroupError } from "../groups/groups.service";
import { InvalidCategoryError } from "../transactions/transactions.service";
import {
  DebtNotFoundError,
  ForbiddenError,
  InstallmentNotFoundError,
  InvalidPayoffError,
  createDebt,
  listDebts,
  payOffDebtForUser,
  removeDebt,
  setInstallmentPaidForUser,
  updateDebtForUser,
  updateInstallmentAmountForUser,
  updateInstallmentMonth,
  type DebtScope,
} from "./debts.service";
import { isNonEmptyString, isValidAmount } from "../../utils/validation";

function isValidDueDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export async function createDebtHandler(req: Request, res: Response) {
  const { name, description, totalAmount, installmentsCount, scope, startMonth, dueDay, categoryId } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    !isValidAmount(totalAmount) ||
    (installmentsCount !== undefined &&
      (typeof installmentsCount !== "number" || !Number.isInteger(installmentsCount) || installmentsCount < 1)) ||
    (scope !== undefined && scope !== "personal" && scope !== "joint") ||
    !isValidMonthParam(startMonth) ||
    (dueDay !== undefined && dueDay !== null && !isValidDueDay(dueDay)) ||
    (categoryId !== undefined && categoryId !== null && !isNonEmptyString(categoryId))
  ) {
    res.status(400).json({
      error:
        "name, totalAmount and startMonth (YYYY-MM) are required; installmentsCount must be a positive integer; dueDay (if set) must be 1-31",
    });
    return;
  }

  let debt;
  try {
    debt = await createDebt(req.user!.id, {
      name: name.trim(),
      description: isNonEmptyString(description) ? description.trim() : null,
      totalAmount,
      installmentsCount: installmentsCount ?? 1,
      scope: (scope as DebtScope) ?? "personal",
      startMonth,
      dueDay: dueDay ?? null,
      categoryId: categoryId ?? null,
    });
  } catch (err) {
    if (err instanceof InvalidCategoryError) {
      res.status(400).json({ error: "Categoria inválida." });
      return;
    }
    throw err;
  }
  res.status(201).json(debt);
}

export async function listDebtsHandler(req: Request, res: Response) {
  const debts = await listDebts(req.user!.id);
  res.status(200).json(debts);
}

export async function setInstallmentPaidHandler(req: Request, res: Response) {
  const { isPaid, referenceMonth, amount } = req.body ?? {};
  const hasMonth = referenceMonth !== undefined;
  const hasAmount = amount !== undefined;
  if (
    (typeof isPaid !== "boolean" && !hasMonth && !hasAmount) ||
    (hasMonth && !isValidMonthParam(referenceMonth)) ||
    (hasAmount && !isValidAmount(amount))
  ) {
    res.status(400).json({ error: "isPaid (boolean), referenceMonth (YYYY-MM) or a positive amount is required" });
    return;
  }

  try {
    const { debtId, installmentId } = req.params;
    let installment;
    if (typeof isPaid === "boolean") {
      installment = await setInstallmentPaidForUser(req.user!.id, debtId, installmentId, isPaid);
    } else {
      if (hasMonth) installment = await updateInstallmentMonth(req.user!.id, debtId, installmentId, referenceMonth);
      if (hasAmount) installment = await updateInstallmentAmountForUser(req.user!.id, debtId, installmentId, amount);
    }
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
  const { name, description, dueDay, categoryId } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    (dueDay !== undefined && dueDay !== null && !isValidDueDay(dueDay)) ||
    (categoryId !== undefined && categoryId !== null && !isNonEmptyString(categoryId))
  ) {
    res.status(400).json({ error: "name is required; dueDay (if set) must be 1-31; categoryId (if set) must be a string or null" });
    return;
  }

  try {
    const debt = await updateDebtForUser(req.user!.id, req.params.id, {
      name: name.trim(),
      description: isNonEmptyString(description) ? description.trim() : null,
      dueDay: dueDay !== undefined ? dueDay : undefined,
      // Sem o campo no pedido, a categoria fica como está.
      categoryId: categoryId !== undefined ? categoryId : undefined,
    });
    res.status(200).json(debt);
  } catch (err) {
    if (err instanceof InvalidCategoryError) {
      res.status(400).json({ error: "Categoria inválida." });
      return;
    }
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

export async function payOffDebtHandler(req: Request, res: Response) {
  const { fromInstallment, amount, referenceMonth } = req.body ?? {};
  if (
    typeof fromInstallment !== "number" ||
    !Number.isInteger(fromInstallment) ||
    fromInstallment < 1 ||
    !isValidAmount(amount) ||
    !isValidMonthParam(referenceMonth)
  ) {
    res.status(400).json({ error: "fromInstallment (>= 1), a positive amount and referenceMonth (YYYY-MM) are required" });
    return;
  }

  try {
    await payOffDebtForUser(req.user!.id, req.params.id, { fromInstallment, amount, referenceMonth });
    res.status(204).send();
  } catch (err) {
    if (err instanceof InvalidPayoffError) {
      res.status(400).json({ error: "Nenhuma parcela nesse trecho." });
      return;
    }
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
