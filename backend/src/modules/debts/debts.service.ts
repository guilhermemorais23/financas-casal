import { findAccountsByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransaction, insertTransaction, updateTransaction } from "../transactions/transactions.repository";
import { splitEvenly } from "../../utils/money";
import { addMonths, monthToDate } from "../../utils/month";
import {
  deleteDebt,
  findDebtById,
  findDebtsVisibleTo,
  findInstallmentById,
  findInstallmentsByDebtIds,
  insertDebt,
  insertInstallments,
  setInstallmentPaid,
  updateDebt,
  updateInstallmentReferenceMonth,
  type DebtInstallmentRow,
} from "./debts.repository";

export class DebtNotFoundError extends Error {}
export class InstallmentNotFoundError extends Error {}
export class ForbiddenError extends Error {}

export type DebtScope = "personal" | "joint";

export interface CreateDebtInput {
  name: string;
  description: string | null;
  totalAmount: number;
  installmentsCount: number;
  scope: DebtScope;
  startMonth: string;
}

export interface DebtWithInstallments {
  id: string;
  scope: DebtScope;
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
  startMonth: string;
  createdBy: string;
  installments: DebtInstallmentRow[];
  paidAmount: number;
  remainingAmount: number;
  paidCount: number;
  remainingCount: number;
}

export async function createDebt(userId: string, input: CreateDebtInput) {
  const groupId = await requireGroupId(userId);
  const ownerUserId = input.scope === "joint" ? null : userId;

  const debt = await insertDebt({
    groupId,
    ownerUserId,
    createdBy: userId,
    name: input.name,
    description: input.description,
    totalAmount: input.totalAmount,
    installmentsCount: input.installmentsCount,
    startMonth: input.startMonth,
  });

  // Installment N books against startMonth + (N-1) by default -- e.g. a
  // debt starting 2026-08 has parcela 1 in August, parcela 2 in September,
  // regardless of which real-world day each one actually gets marked paid.
  const shares = splitEvenly(input.totalAmount, input.installmentsCount);
  const installments = shares.map((amountCents, index) => ({
    amountCents,
    referenceMonth: addMonths(input.startMonth, index),
  }));
  await insertInstallments(debt.id, installments);

  return debt;
}

export async function listDebts(userId: string): Promise<DebtWithInstallments[]> {
  const groupId = await requireGroupId(userId);
  const debts = await findDebtsVisibleTo(groupId, userId);
  const installments = await findInstallmentsByDebtIds(debts.map((debt) => debt.id));

  return debts.map((debt) => {
    const debtInstallments = installments.filter((installment) => installment.debtId === debt.id);
    const paid = debtInstallments.filter((installment) => installment.isPaid);
    const paidAmount = paid.reduce((sum, installment) => sum + Number(installment.amount), 0);
    const totalAmount = Number(debt.totalAmount);

    return {
      id: debt.id,
      scope: debt.ownerUserId ? "personal" : "joint",
      name: debt.name,
      description: debt.description,
      totalAmount: debt.totalAmount,
      installmentsCount: debt.installmentsCount,
      startMonth: debt.startMonth,
      createdBy: debt.createdBy,
      installments: debtInstallments,
      paidAmount,
      remainingAmount: totalAmount - paidAmount,
      paidCount: paid.length,
      remainingCount: debtInstallments.length - paid.length,
    };
  });
}

async function requireManageableDebt(userId: string, debtId: string) {
  const groupId = await requireGroupId(userId);
  const debt = await findDebtById(debtId);
  if (!debt || debt.groupId !== groupId) {
    throw new DebtNotFoundError();
  }
  if (debt.ownerUserId && debt.ownerUserId !== userId) {
    throw new ForbiddenError();
  }
  return debt;
}

// Keeps a debt's progress bar backed by the actual money ledger instead of a
// disconnected checkbox: paying an installment logs a real expense (so it
// shows up in the extrato/relatórios and hits the account balance), and
// unmarking it removes that same expense again.
export async function setInstallmentPaidForUser(
  userId: string,
  debtId: string,
  installmentId: string,
  isPaid: boolean
) {
  const groupId = await requireGroupId(userId);
  const debt = await requireManageableDebt(userId, debtId);
  const installment = await findInstallmentById(debtId, installmentId);
  if (!installment) {
    throw new InstallmentNotFoundError();
  }

  if (isPaid && !installment.isPaid) {
    const accounts = await findAccountsByGroupId(groupId);
    const account = debt.ownerUserId
      ? accounts.find((a) => a.type === "personal" && a.ownerUserId === debt.ownerUserId)
      : accounts.find((a) => a.type === "joint");
    if (!account) {
      throw new DebtNotFoundError();
    }

    const transaction = await insertTransaction({
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      categoryId: null,
      payerId: userId,
      createdBy: userId,
      description: `${debt.name} — parcela ${installment.installmentNumber}/${debt.installmentsCount}`,
      amount: Number(installment.amount),
      transactionType: "expense",
      occurredAt: monthToDate(installment.referenceMonth),
      isPrivate: false,
      splitType: "none",
    });
    return setInstallmentPaid(debtId, installmentId, true, transaction.id);
  }

  if (!isPaid && installment.isPaid) {
    if (installment.transactionId) {
      await deleteTransaction(installment.transactionId);
    }
    return setInstallmentPaid(debtId, installmentId, false, null);
  }

  return installment;
}

// Lets a user re-book a specific installment into a different month --
// e.g. they caught up and paid parcela 1 and 2 in the same real month, so
// parcela 2 should count against that same month instead of the default
// startMonth+1. If it's already paid, the linked transaction's date moves
// along with it so the extrato stays consistent.
export async function updateInstallmentMonth(
  userId: string,
  debtId: string,
  installmentId: string,
  referenceMonth: string
) {
  await requireManageableDebt(userId, debtId);
  const installment = await findInstallmentById(debtId, installmentId);
  if (!installment) {
    throw new InstallmentNotFoundError();
  }

  const updated = await updateInstallmentReferenceMonth(debtId, installmentId, referenceMonth);
  if (installment.isPaid && installment.transactionId) {
    await updateTransaction(installment.transactionId, { occurredAt: monthToDate(referenceMonth) });
  }
  return updated;
}

export async function removeDebt(userId: string, debtId: string) {
  await requireManageableDebt(userId, debtId);
  await deleteDebt(debtId);
}

export async function updateDebtForUser(
  userId: string,
  debtId: string,
  input: { name: string; description: string | null }
) {
  await requireManageableDebt(userId, debtId);
  return updateDebt(debtId, input);
}
