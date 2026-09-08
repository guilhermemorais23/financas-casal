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
  getYearlySummary,
  insertSplits,
  insertTransaction,
  insertTransactionSeries,
  setTransactionSettled,
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

export class InvalidYearError extends Error {}

export async function getYearlySummaryForUser(userId: string, yearParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new InvalidYearError();
  }
  return getYearlySummary(groupId, userId, year, scope);
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

export class NotSplitError extends Error {}
export class InvalidSettlementAmountError extends Error {}

// "Marcar como pago" -- unlike a plain status flag, this actually books the
// money: creates a real income transaction for whatever the other member(s)
// paid back (a Pix, cash...) on the same account the original expense hit,
// so the Painel/saldo reflects it too, not just a "not owed anymore" label.
// Same linked-transaction pattern as debts/cards/shopping: settlementTransactionId
// on the original expense points at it, and reopening ("em aberto" again)
// deletes it -- the split status and that income entry always move together.
export async function setSplitSettledForUser(
  userId: string,
  transactionId: string,
  isSettled: boolean,
  amount?: number
) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  if (transaction.splitType === "none") {
    throw new NotSplitError();
  }

  if (isSettled) {
    if (typeof amount !== "number" || amount <= 0) {
      throw new InvalidSettlementAmountError();
    }
    const settlementTx = await insertTransaction({
      groupId: transaction.groupId,
      accountId: transaction.accountId,
      accountType: transaction.accountType,
      accountOwnerId: transaction.accountOwnerId,
      categoryId: null,
      payerId: userId,
      createdBy: userId,
      description: `Reembolso: ${transaction.description}`,
      amount,
      transactionType: "income",
      occurredAt: new Date().toISOString().slice(0, 10),
      isPrivate: false,
      splitType: "none",
    });
    return setTransactionSettled(transactionId, true, settlementTx.id);
  }

  if (transaction.settlementTransactionId) {
    await deleteTransaction(transaction.settlementTransactionId);
  }
  return setTransactionSettled(transactionId, false, null);
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

export class InvalidRecurringUpdateError extends Error {}

// "The rent went up" -- unlike a plain edit (which only ever touches the
// one occurrence you clicked), this rewrites the amount/description on
// this occurrence and every later one in the same series, leaving past
// (already-happened) occurrences exactly as they were. Same "this and
// future" scope as cancelRecurringForUser above.
export async function updateRecurringForUser(
  userId: string,
  transactionId: string,
  input: { amount?: number; description?: string }
) {
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
  if (input.amount === undefined && input.description === undefined) {
    throw new InvalidRecurringUpdateError();
  }
  if (input.amount !== undefined && input.amount <= 0) {
    throw new InvalidRecurringUpdateError();
  }

  const series = await findRecurringSeries(transaction.recurringGroupId);
  const futureOccurrences = series.filter((occurrence) => occurrence.occurredAt >= transaction.occurredAt);

  const members = input.amount !== undefined ? await findMembersByGroupId(groupId) : [];
  await Promise.all(
    futureOccurrences.map(async (occurrence) => {
      await updateTransaction(occurrence.id, { amount: input.amount, description: input.description });
      // Each occurrence carries its own splits (independent docs, created
      // per-occurrence when the series was first generated) -- an amount
      // change has to resync every one of them individually, same as a
      // regular single-transaction edit does for its own splits.
      if (input.amount !== undefined && occurrence.splitType === "equal" && members.length > 1) {
        const shares = splitEvenly(input.amount, members.length);
        await deleteSplitsForTransaction(occurrence.id);
        await insertSplits(
          groupId,
          occurrence.id,
          members.map((member, index) => ({ userId: member.id, shareAmountCents: shares[index] }))
        );
      }
    })
  );

  return { updatedCount: futureOccurrences.length };
}

export interface UpdateTransactionInput {
  description?: string;
  amount?: number;
  transactionType?: TransactionType;
  categoryId?: string | null;
  occurredAt?: string;
  payerId?: string;
  accountId?: string;
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

  // Moving a transaction to a different account means the target account
  // must also belong to this group -- otherwise you could quietly move
  // money into (or a private expense onto) an account nobody here owns.
  // accountType/accountOwnerId are denormalized onto the transaction from
  // the account at write time (same as on create) and have to be
  // refreshed together whenever accountId changes.
  let accountFields: { accountId?: string; accountType?: "personal" | "joint"; accountOwnerId?: string | null } = {};
  if (input.accountId !== undefined && input.accountId !== transaction.accountId) {
    const accounts = await findAccountsByGroupId(groupId);
    const account = accounts.find((a) => a.id === input.accountId);
    if (!account) {
      throw new InvalidAccountError();
    }
    accountFields = { accountId: account.id, accountType: account.type, accountOwnerId: account.ownerUserId };
  }

  if (input.payerId !== undefined && input.payerId !== transaction.payerId) {
    const members = await findMembersByGroupId(groupId);
    if (!members.some((member) => member.id === input.payerId)) {
      throw new InvalidPayerError();
    }
  }

  const updated = await updateTransaction(transactionId, {
    description: input.description,
    amount: input.amount,
    transactionType: input.transactionType,
    categoryId: input.categoryId,
    occurredAt: input.occurredAt,
    payerId: input.payerId,
    ...accountFields,
  });

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
