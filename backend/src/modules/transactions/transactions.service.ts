import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByCoupleId, findMembersByCoupleId } from "../couples/couples.repository";
import { requireCoupleId } from "../couples/couples.service";
import { parseMonthRange } from "../../utils/month";
import {
  deleteSplitsForTransaction,
  deleteTransaction,
  findTransactionById,
  findTransactionsVisibleTo,
  getBalanceRows,
  getMonthlySummary,
  insertSplits,
  insertTransaction,
  updateTransaction,
  type SplitType,
  type TransactionType,
} from "./transactions.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidAccountError extends Error {}
export class InvalidPayerError extends Error {}
export class InvalidCategoryError extends Error {}
export class UnsupportedSplitTypeError extends Error {}
export class TransactionNotFoundError extends Error {}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

export interface CreateTransactionInput {
  accountId: string;
  categoryId: string | null;
  payerId: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
}

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const coupleId = await requireCoupleId(userId);

  const accounts = await findAccountsByCoupleId(coupleId);
  if (!accounts.some((account) => account.id === input.accountId)) {
    throw new InvalidAccountError();
  }

  const members = await findMembersByCoupleId(coupleId);
  if (!members.some((member) => member.id === input.payerId)) {
    throw new InvalidPayerError();
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, coupleId))) {
    throw new InvalidCategoryError();
  }

  if (!SUPPORTED_SPLIT_TYPES.includes(input.splitType)) {
    throw new UnsupportedSplitTypeError();
  }

  const transaction = await insertTransaction({
    coupleId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    payerId: input.payerId,
    createdBy: userId,
    description: input.description,
    amount: input.amount,
    transactionType: input.transactionType,
    occurredAt: input.occurredAt,
    isPrivate: input.isPrivate,
    splitType: input.splitType,
  });

  // Splits model who owes whom on a shared expense; income has no such debt.
  if (input.transactionType === "expense" && input.splitType === "equal" && members.length === 2) {
    const cents = Math.round(input.amount * 100);
    const half = Math.floor(cents / 2);
    const other = cents - half;
    const payer = members.find((member) => member.id === input.payerId)!;
    const partner = members.find((member) => member.id !== input.payerId)!;

    await insertSplits(transaction.id, [
      { userId: payer.id, shareAmount: half / 100 },
      { userId: partner.id, shareAmount: other / 100 },
    ]);
  }

  return transaction;
}

export async function listTransactions(
  userId: string,
  limit: number,
  monthParam?: string,
  accountId?: string
) {
  const coupleId = await requireCoupleId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(coupleId, userId, limit, range, accountId);
}

export async function getBalance(userId: string) {
  const coupleId = await requireCoupleId(userId);
  const rows = await getBalanceRows(coupleId);
  const members = await findMembersByCoupleId(coupleId);

  const balances = members.map((member) => {
    const owedToThem = rows
      .filter((row) => row.paid_by === member.id)
      .reduce((sum, row) => sum + Number(row.total_owed), 0);
    const owedByThem = rows
      .filter((row) => row.owed_by === member.id)
      .reduce((sum, row) => sum + Number(row.total_owed), 0);
    return { userId: member.id, netAmount: owedToThem - owedByThem };
  });

  return { balances };
}

export async function getMonthlySummaryForUser(userId: string, monthParam?: string) {
  const coupleId = await requireCoupleId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);
  const summary = await getMonthlySummary(coupleId, userId, monthStart, monthEnd);
  return { periodMonth, ...summary };
}

export async function deleteTransactionForUser(userId: string, transactionId: string) {
  const coupleId = await requireCoupleId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.couple_id !== coupleId || transaction.created_by !== userId) {
    throw new TransactionNotFoundError();
  }
  await deleteTransaction(transactionId);
}

export interface UpdateTransactionInput {
  description?: string;
  amount?: number;
  transactionType?: TransactionType;
  categoryId?: string | null;
  occurredAt?: string;
}

export async function updateTransactionForUser(
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput
) {
  const coupleId = await requireCoupleId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.couple_id !== coupleId || transaction.created_by !== userId) {
    throw new TransactionNotFoundError();
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, coupleId))) {
    throw new InvalidCategoryError();
  }

  const updated = await updateTransaction(transactionId, input);

  // Keep "who owes whom" consistent with the edited amount/type: income has no
  // debt, and an equal-split expense's 50/50 halves must track the new amount.
  const nextType = input.transactionType ?? transaction.transaction_type;
  if (nextType === "income") {
    if (transaction.split_type !== "none") {
      await deleteSplitsForTransaction(transactionId);
    }
  } else if (transaction.split_type === "equal" && input.amount !== undefined) {
    const members = await findMembersByCoupleId(coupleId);
    if (members.length === 2) {
      const cents = Math.round(input.amount * 100);
      const half = Math.floor(cents / 2);
      const other = cents - half;
      const payer = members.find((member) => member.id === transaction.payer_id)!;
      const partner = members.find((member) => member.id !== transaction.payer_id)!;

      await deleteSplitsForTransaction(transactionId);
      await insertSplits(transactionId, [
        { userId: payer.id, shareAmount: half / 100 },
        { userId: partner.id, shareAmount: other / 100 },
      ]);
    }
  }

  return updated;
}
