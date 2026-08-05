import { findAccountsByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransaction, insertTransaction } from "../transactions/transactions.repository";
import { splitEvenly } from "../../utils/money";
import {
  deleteDebt,
  findDebtById,
  findDebtsVisibleTo,
  findInstallmentById,
  findInstallmentsByDebtIds,
  insertDebt,
  insertInstallments,
  setInstallmentPaid,
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
}

export interface DebtWithInstallments {
  id: string;
  scope: DebtScope;
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
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
  });

  const shares = splitEvenly(input.totalAmount, input.installmentsCount);
  await insertInstallments(debt.id, shares);

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
      occurredAt: new Date().toISOString().slice(0, 10),
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

export async function removeDebt(userId: string, debtId: string) {
  await requireManageableDebt(userId, debtId);
  await deleteDebt(debtId);
}
