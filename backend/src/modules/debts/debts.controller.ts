import type { Request, Response } from "express";
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
  type DebtScope,
} from "./debts.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createDebtHandler(req: Request, res: Response) {
  const { name, description, totalAmount, installmentsCount, scope } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    typeof totalAmount !== "number" ||
    totalAmount <= 0 ||
    (installmentsCount !== undefined &&
      (typeof installmentsCount !== "number" || !Number.isInteger(installmentsCount) || installmentsCount < 1)) ||
    (scope !== undefined && scope !== "personal" && scope !== "joint")
  ) {
    res.status(400).json({ error: "name, totalAmount are required; installmentsCount must be a positive integer" });
    return;
  }

  try {
    const debt = await createDebt(req.user!.id, {
      name: name.trim(),
      description: isNonEmptyString(description) ? description.trim() : null,
      totalAmount,
      installmentsCount: installmentsCount ?? 1,
      scope: (scope as DebtScope) ?? "personal",
    });
    res.status(201).json(debt);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function listDebtsHandler(req: Request, res: Response) {
  try {
    const debts = await listDebts(req.user!.id);
    res.status(200).json(debts);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function setInstallmentPaidHandler(req: Request, res: Response) {
  const { isPaid } = req.body ?? {};
  if (typeof isPaid !== "boolean") {
    res.status(400).json({ error: "isPaid is required" });
    return;
  }

  try {
    const installment = await setInstallmentPaidForUser(
      req.user!.id,
      req.params.debtId,
      req.params.installmentId,
      isPaid
    );
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
  const { name, description } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const debt = await updateDebtForUser(req.user!.id, req.params.id, {
      name: name.trim(),
      description: isNonEmptyString(description) ? description.trim() : null,
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
