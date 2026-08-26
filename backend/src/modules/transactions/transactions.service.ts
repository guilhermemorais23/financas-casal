import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { addMonthsToDate, parseMonthRange } from "../../utils/month";
import { splitEvenly } from "../../utils/money";
import {
  deleteSplitsForTransaction,
  deleteTransaction,
  deleteTransactionsBatch,
  findRecurringSeries,
  findTransactionById,
  findTransactionsVisibleTo,
  getBalanceRows,
  getDailySeries,
  getMonthlySummary,
  insertSplits,
  insertTransaction,
  insertTransactionSeries,
  updateTransaction,
  type SplitType,
  type SummaryScope,
  type TransactionType,
} from "./transactions.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidAccountError extends Error {}
export class InvalidPayerError extends Error {}
export class InvalidCategoryError extends Error {}
export class UnsupportedSplitTypeError extends Error {}
export class TransactionNotFoundError extends Error {}
export class InvalidRecurrenceError extends Error {}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

// A recurring series is generated whole at creation time (no cron): 2
// occurrences is the smallest thing worth calling "recurring" at all, 36
// (3 years of a subscription/rent) is a sane upper bound so nobody fat-fingers
// a 4-digit month count into a Firestore batch write.
export const MIN_RECURRENCE_MONTHS = 2;
export const MAX_RECURRENCE_MONTHS = 36;

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
  // When set, generates `months` occurrences (this one plus months-1 more,
  // one per month, same day-of-month clamped to shorter months) in one go
  // instead of just this single transaction.
  recurring?: { months: number };
}

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const groupId = await requireGroupId(userId);

  const [accounts, members] = await Promise.all([
    findAccountsByGroupId(groupId),
    findMembersByGroupId(groupId),
  ]);
  const account = accounts.find((a) => a.id === input.accountId);
  if (!account) {
    throw new InvalidAccountError();
  }

  if (!members.some((member) => member.id === input.payerId)) {
    throw new InvalidPayerError();
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  if (!SUPPORTED_SPLIT_TYPES.includes(input.splitType)) {
    throw new UnsupportedSplitTypeError();
  }

  let occurredAtDates = [input.occurredAt];
  if (input.recurring) {
    const { months } = input.recurring;
    if (!Number.isInteger(months) || months < MIN_RECURRENCE_MONTHS || months > MAX_RECURRENCE_MONTHS) {
      throw new InvalidRecurrenceError();
    }
    occurredAtDates = Array.from({ length: months }, (_, index) => addMonthsToDate(input.occurredAt, index));
  }

  const transactions = await insertTransactionSeries(
    {
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      categoryId: input.categoryId,
      payerId: input.payerId,
      createdBy: userId,
      description: input.description,
      amount: input.amount,
      transactionType: input.transactionType,
      isPrivate: input.isPrivate,
      splitType: input.splitType,
    },
    occurredAtDates
  );

  // Splits model who owes whom on a shared expense; income has no such debt.
  // Divides evenly across however many members the group actually has. Every
  // occurrence of a recurring series gets its own splits, same as a one-off.
  if (input.transactionType === "expense" && input.splitType === "equal" && members.length > 1) {
    const shares = splitEvenly(input.amount, members.length);
    await Promise.all(
      transactions.map((transaction) =>
        insertSplits(
          groupId,
          transaction.id,
          members.map((member, index) => ({ userId: member.id, shareAmountCents: shares[index] }))
        )
      )
    );
  }

  return transactions[0];
}

export async function listTransactions(
  userId: string,
  limit: number,
  monthParam?: string,
  accountId?: string
) {
  const groupId = await requireGroupId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(groupId, userId, limit, range, accountId);
}

// Same visibility rules as the normal list -- export never leaks a
// groupmate's private personal transaction either. 10k is far above what
// any group would have in a single month; a hard cap just protects the
// export from growing unbounded if someone ever calls it without a month.
export async function exportTransactionsForUser(userId: string, monthParam?: string) {
  const groupId = await requireGroupId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(groupId, userId, 10000, range);
}

// Pairwise "who owes whom" across every member pair with a shared-expense
// debt. Not currently surfaced in any UI page.
export async function getBalance(userId: string) {
  const groupId = await requireGroupId(userId);
  const rows = await getBalanceRows(groupId);

  const netByPair = new Map<string, number>();
  for (const row of rows) {
    const [a, b] = [row.paidBy, row.owedBy].sort();
    const sign = a === row.paidBy ? 1 : -1;
    const key = `${a}_${b}`;
    netByPair.set(key, (netByPair.get(key) ?? 0) + sign * Number(row.totalOwed));
  }

  const balances = Array.from(netByPair.entries()).map(([key, amount]) => {
    const [a, b] = key.split("_");
    return amount >= 0 ? { fromUserId: b, toUserId: a, amount } : { fromUserId: a, toUserId: b, amount: -amount };
  });

  return { balances };
}

export async function getMonthlySummaryForUser(userId: string, monthParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);
  const summary = await getMonthlySummary(groupId, userId, monthStart, monthEnd, scope);
  return { periodMonth, ...summary };
}

export async function getDailySeriesForUser(userId: string, monthParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const { monthStart, monthEnd } = parseMonthRange(monthParam);
  return getDailySeries(groupId, userId, monthStart, monthEnd, scope);
}

// Joint-account transactions are manageable by any group member (same rule
// as joint debts); personal-account transactions stay restricted to whoever
// created them.
function canManageTransaction(userId: string, transaction: { accountType: string; createdBy: string }): boolean {
  return transaction.accountType === "joint" || transaction.createdBy === userId;
}

export async function deleteTransactionForUser(userId: string, transactionId: string) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  await deleteTransaction(transactionId);
}

// "Cancel this subscription/rent/salary" -- deletes this occurrence and
// every later one in the same recurring series, leaving past occurrences
// (already-happened months) untouched in the ledger.
export async function cancelRecurringForUser(userId: string, transactionId: string) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (
    !transaction ||
    transaction.groupId !== groupId ||
    !transaction.recurringGroupId ||
    !canManageTransaction(userId, transaction)
  ) {
    throw new TransactionNotFoundError();
  }

  const series = await findRecurringSeries(transaction.recurringGroupId);
  const idsToDelete = series
    .filter((occurrence) => occurrence.occurredAt >= transaction.occurredAt)
    .map((occurrence) => occurrence.id);
  await deleteTransactionsBatch(idsToDelete);
  return { cancelledCount: idsToDelete.length };
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
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  const updated = await updateTransaction(transactionId, input);

  // Keep "who owes whom" consistent with the edited amount/type: income has
  // no debt, and an equal-split expense's shares must track the new amount.
  const nextType = input.transactionType ?? transaction.transactionType;
  if (nextType === "income") {
    if (transaction.splitType !== "none") {
      await deleteSplitsForTransaction(transactionId);
    }
  } else if (transaction.splitType === "equal" && input.amount !== undefined) {
    const members = await findMembersByGroupId(groupId);
    if (members.length > 1) {
      const shares = splitEvenly(input.amount, members.length);
      await deleteSplitsForTransaction(transactionId);
      await insertSplits(
        groupId,
        transactionId,
        members.map((member, index) => ({ userId: member.id, shareAmountCents: shares[index] }))
      );
    }
  }

  return updated;
}
