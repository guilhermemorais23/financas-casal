import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByCoupleId, findMembersByCoupleId } from "../couples/couples.repository";
import { requireCoupleId } from "../couples/couples.service";
import {
  findTransactionsVisibleTo,
  getBalanceRows,
  insertSplits,
  insertTransaction,
  type SplitType,
} from "./transactions.repository";

export class InvalidAccountError extends Error {}
export class InvalidPayerError extends Error {}
export class InvalidCategoryError extends Error {}
export class UnsupportedSplitTypeError extends Error {}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

export interface CreateExpenseInput {
  accountId: string;
  categoryId: string | null;
  payerId: string;
  description: string;
  amount: number;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
}

export async function createExpense(userId: string, input: CreateExpenseInput) {
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
    occurredAt: input.occurredAt,
    isPrivate: input.isPrivate,
    splitType: input.splitType,
  });

  if (input.splitType === "equal" && members.length === 2) {
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

export async function listTransactions(userId: string, limit: number) {
  const coupleId = await requireCoupleId(userId);
  return findTransactionsVisibleTo(coupleId, userId, limit);
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
