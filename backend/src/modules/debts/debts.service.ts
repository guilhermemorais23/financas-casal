import { FieldValue } from "firebase-admin/firestore";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountForOwner } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { InvalidCategoryError } from "../transactions/transactions.service";
import {
  prepareTransactionDelete,
  runLedgerTransaction,
  updateTransaction,
  writeNewTransaction,
} from "../transactions/transactions.repository";
import { splitEvenly } from "../../utils/money";
import { addMonths, dateForDayInMonth, monthToDate, todayInBrazil } from "../../utils/month";
import {
  deleteDebt,
  findDebtById,
  findDebtsVisibleTo,
  findInstallmentById,
  findInstallmentsByDebtIds,
  insertDebt,
  insertInstallments,
  updateDebt,
  updateInstallmentReferenceMonth,
  type DebtInstallmentRow,
  installmentRef,
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
  dueDay: number | null;
  // Opcional: categoria do gasto que entra no extrato ao pagar.
  categoryId?: string | null;
}

export interface DebtWithInstallments {
  id: string;
  scope: DebtScope;
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
  startMonth: string;
  dueDay: number | null;
  categoryId: string | null;
  createdBy: string;
  installments: (DebtInstallmentRow & { dueDate: string | null })[];
  paidAmount: number;
  remainingAmount: number;
  paidCount: number;
  remainingCount: number;
}

export async function createDebt(userId: string, input: CreateDebtInput) {
  const groupId = await requireGroupId(userId);
  const ownerUserId = input.scope === "joint" ? null : userId;
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  const debt = await insertDebt({
    groupId,
    ownerUserId,
    createdBy: userId,
    name: input.name,
    description: input.description,
    totalAmount: input.totalAmount,
    installmentsCount: input.installmentsCount,
    startMonth: input.startMonth,
    dueDay: input.dueDay,
    categoryId: input.categoryId ?? null,
  });

  // A parcela N entra, por padrão, em startMonth + (N-1) -- ex.: uma dívida que
  // começa em 2026-08 tem a parcela 1 em agosto e a 2 em setembro, não importa
  // o dia real em que cada uma é marcada como paga.
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

  const installmentsByDebtId = new Map<string, DebtInstallmentRow[]>();
  for (const installment of installments) {
    const list = installmentsByDebtId.get(installment.debtId);
    if (list) {
      list.push(installment);
    } else {
      installmentsByDebtId.set(installment.debtId, [installment]);
    }
  }

  return debts.map((debt) => {
    const debtInstallments = installmentsByDebtId.get(debt.id) ?? [];
    const paid = debtInstallments.filter((installment) => installment.isPaid);
    const paidAmount = paid.reduce((sum, installment) => sum + Number(installment.amount), 0);
    const totalAmount = Number(debt.totalAmount);
    const installmentsWithDueDate = debtInstallments.map((installment) => ({
      ...installment,
      dueDate: debt.dueDay ? dateForDayInMonth(installment.referenceMonth, debt.dueDay) : null,
    }));

    return {
      id: debt.id,
      scope: debt.ownerUserId ? "personal" : "joint",
      name: debt.name,
      description: debt.description,
      totalAmount: debt.totalAmount,
      installmentsCount: debt.installmentsCount,
      startMonth: debt.startMonth,
      dueDay: debt.dueDay,
      categoryId: debt.categoryId,
      createdBy: debt.createdBy,
      installments: installmentsWithDueDate,
      paidAmount,
      remainingAmount: totalAmount - paidAmount,
      paidCount: paid.length,
      remainingCount: debtInstallments.length - paid.length,
    };
  });
}

async function requireManageableDebt(userId: string, groupId: string, debtId: string) {
  const debt = await findDebtById(debtId);
  if (!debt || debt.groupId !== groupId) {
    throw new DebtNotFoundError();
  }
  if (debt.ownerUserId && debt.ownerUserId !== userId) {
    throw new ForbiddenError();
  }
  return debt;
}

// Faz a barra de progresso da dívida refletir o dinheiro de verdade, e não
// uma caixinha solta: pagar uma parcela lança um gasto real (aparece no
// extrato e nos relatórios e mexe no saldo da conta), e desmarcar apaga esse
// mesmo gasto.
export async function setInstallmentPaidForUser(
  userId: string,
  debtId: string,
  installmentId: string,
  isPaid: boolean
) {
  const groupId = await requireGroupId(userId);
  const debt = await requireManageableDebt(userId, groupId, debtId);
  const installment = await findInstallmentById(debtId, installmentId);
  if (!installment) {
    throw new InstallmentNotFoundError();
  }

  const ref = installmentRef(debtId, installmentId);
  // Parcela e lançamento mudam juntos numa transação do Firestore, que relê a
  // parcela: dois cliques em "paga" não lançam a parcela duas vezes.
  if (isPaid && !installment.isPaid) {
    const account = await findAccountForOwner(groupId, debt.ownerUserId);
    if (!account) {
      throw new DebtNotFoundError();
    }

    // Conta "só esta vez" (1 parcela): o gasto leva o nome da conta e a data
    // do pagamento -- uma conta atrasada paga hoje entra no mês de hoje, não
    // no mês em que venceu.
    const single = debt.installmentsCount === 1;
    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(ref);
      if (!current.exists || current.data()!.isPaid) return;
      const transactionId = writeNewTransaction(t, {
        groupId,
        accountId: account.id,
        accountType: account.type,
        accountOwnerId: account.ownerUserId,
        categoryId: debt.categoryId,
        payerId: userId,
        createdBy: userId,
        description: single ? debt.name : `${debt.name} — parcela ${installment.installmentNumber}/${debt.installmentsCount}`,
        amount: Number(installment.amount),
        transactionType: "expense",
        occurredAt: single ? todayInBrazil() : monthToDate(installment.referenceMonth),
        isPrivate: false,
        splitType: "none",
        linkKind: "debt_installment",
      });
      t.update(ref, { isPaid: true, paidAt: FieldValue.serverTimestamp(), transactionId });
    });
    return (await findInstallmentById(debtId, installmentId))!;
  }

  if (!isPaid && installment.isPaid) {
    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(ref);
      if (!current.exists || !current.data()!.isPaid) return;
      const transactionId = current.data()!.transactionId as string | null;
      const removal = transactionId ? await prepareTransactionDelete(t, transactionId) : null;
      removal?.apply();
      t.update(ref, { isPaid: false, paidAt: null, transactionId: null });
    });
    return (await findInstallmentById(debtId, installmentId))!;
  }

  return installment;
}

// Deixa a pessoa mudar uma parcela de mês -- ex.: ela pôs o atraso em dia e
// pagou as parcelas 1 e 2 no mesmo mês, então a 2 deve contar nesse mês, e
// não no padrão startMonth+1. Se já estiver paga, a data do lançamento
// ligado a ela vai junto, pro extrato continuar batendo.
export async function updateInstallmentMonth(
  userId: string,
  debtId: string,
  installmentId: string,
  referenceMonth: string
) {
  const groupId = await requireGroupId(userId);
  await requireManageableDebt(userId, groupId, debtId);
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
  const groupId = await requireGroupId(userId);
  await requireManageableDebt(userId, groupId, debtId);
  await deleteDebt(debtId);
}

export async function updateDebtForUser(
  userId: string,
  debtId: string,
  input: { name: string; description: string | null; dueDay?: number | null; categoryId?: string | null }
) {
  const groupId = await requireGroupId(userId);
  await requireManageableDebt(userId, groupId, debtId);
  // Mesma conferência da criação: só categoria padrão ou do próprio grupo.
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }
  return updateDebt(debtId, input);
}
