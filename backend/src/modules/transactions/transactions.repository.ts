import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { findVisibleCategories } from "../categories/categories.repository";
import { fromCents, toCents } from "../../utils/money";

export type SplitType = "none" | "equal" | "proportional" | "by_category" | "custom";
export type TransactionType = "expense" | "income";

export interface TransactionRow {
  id: string;
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  categoryId: string | null;
  payerId: string;
  createdBy: string;
  description: string;
  amount: string;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
  // Set only on transactions generated as part of a recurring series (a
  // subscription, rent, salary...). recurringGroupId is the id of the first
  // occurrence in the series (shared by every occurrence, including that
  // first one); recurringIndex/recurringTotal locate it within the series
  // (e.g. 3 of 12). Plain one-off transactions leave all three null.
  recurringGroupId: string | null;
  recurringIndex: number | null;
  recurringTotal: number | null;
}

export interface TransactionListRow extends TransactionRow {
  categoryName: string | null;
  categoryEmoji: string | null;
}

const transactionsCol = db.collection("transactions");

function toTransactionRow(doc: FirebaseFirestore.DocumentSnapshot): TransactionRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    accountId: data.accountId,
    accountType: data.accountType,
    accountOwnerId: data.accountOwnerId ?? null,
    categoryId: data.categoryId ?? null,
    payerId: data.payerId,
    createdBy: data.createdBy,
    description: data.description,
    amount: fromCents(data.amountCents),
    transactionType: data.transactionType,
    occurredAt: data.occurredAt,
    isPrivate: data.isPrivate,
    splitType: data.splitType,
    recurringGroupId: data.recurringGroupId ?? null,
    recurringIndex: data.recurringIndex ?? null,
    recurringTotal: data.recurringTotal ?? null,
  };
}

async function loadCategoriesMap(groupId: string): Promise<Map<string, { name: string; emoji: string | null }>> {
  const categories = await findVisibleCategories(groupId);
  return new Map(categories.map((c) => [c.id, { name: c.name, emoji: c.emoji }]));
}

export interface NewTransactionInput {
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  categoryId: string | null;
  payerId: string;
  createdBy: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
}

export async function insertTransaction(input: NewTransactionInput): Promise<TransactionRow> {
  const [row] = await insertTransactionSeries(input, [input.occurredAt]);
  return row;
}

// Writes every occurrence of a recurring series (or, with a single-element
// `occurredAtDates`, one plain transaction -- insertTransaction above is
// exactly that case) in one batch. Doc refs are allocated up front so the
// first occurrence's id is known before the write, which is what every
// occurrence (including that first one) stores as recurringGroupId -- the
// handle later used to find/cancel "this and every future occurrence".
export async function insertTransactionSeries(
  base: Omit<NewTransactionInput, "occurredAt">,
  occurredAtDates: string[]
): Promise<TransactionRow[]> {
  const refs = occurredAtDates.map(() => transactionsCol.doc());
  const isRecurring = occurredAtDates.length > 1;
  const recurringGroupId = isRecurring ? refs[0].id : null;
  const amountCents = toCents(base.amount);

  const batch = db.batch();
  refs.forEach((ref, index) => {
    batch.set(ref, {
      groupId: base.groupId,
      accountId: base.accountId,
      accountType: base.accountType,
      accountOwnerId: base.accountOwnerId,
      categoryId: base.categoryId,
      payerId: base.payerId,
      createdBy: base.createdBy,
      description: base.description,
      amountCents,
      transactionType: base.transactionType,
      occurredAt: occurredAtDates[index],
      isPrivate: base.isPrivate,
      splitType: base.splitType,
      recurringGroupId,
      recurringIndex: isRecurring ? index + 1 : null,
      recurringTotal: isRecurring ? occurredAtDates.length : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  const docs = await Promise.all(refs.map((ref) => ref.get()));
  return docs.map(toTransactionRow);
}

// Every occurrence sharing a recurringGroupId -- a single equality filter,
// no composite index needed. The caller (cancelRecurringForUser) filters
// down to "this one and the future ones" in memory; a series tops out at
// MAX_RECURRENCE_MONTHS (36) rows, cheap either way.
export async function findRecurringSeries(recurringGroupId: string): Promise<TransactionRow[]> {
  const snapshot = await transactionsCol.where("recurringGroupId", "==", recurringGroupId).get();
  return snapshot.docs.map(toTransactionRow);
}

export async function deleteTransactionsBatch(transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  await Promise.all(transactionIds.map((id) => deleteSplitsForTransaction(id)));
  const batch = db.batch();
  transactionIds.forEach((id) => batch.delete(transactionsCol.doc(id)));
  await batch.commit();
}

// Doc ID = userId within the subcollection -- matches SQL's
// UNIQUE(transaction_id, user_id). groupId/transactionId are denormalized
// onto each split so the balance ledger can collection-group query them.
export async function insertSplits(
  groupId: string,
  transactionId: string,
  splits: { userId: string; shareAmountCents: number }[]
): Promise<void> {
  const splitsCol = transactionsCol.doc(transactionId).collection("splits");
  const batch = db.batch();
  for (const split of splits) {
    batch.set(splitsCol.doc(split.userId), {
      groupId,
      transactionId,
      userId: split.userId,
      shareAmountCents: split.shareAmountCents,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function deleteSplitsForTransaction(transactionId: string): Promise<void> {
  const snapshot = await transactionsCol.doc(transactionId).collection("splits").get();
  if (snapshot.empty) return;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

export async function findTransactionsVisibleTo(
  groupId: string,
  requestingUserId: string,
  limit: number,
  range?: { monthStart: string; monthEnd: string },
  accountId?: string
): Promise<TransactionListRow[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint");
  let ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId);

  if (accountId) {
    jointQuery = jointQuery.where("accountId", "==", accountId);
    ownQuery = ownQuery.where("accountId", "==", accountId);
  }
  if (range) {
    jointQuery = jointQuery.where("occurredAt", ">=", range.monthStart).where("occurredAt", "<", range.monthEnd);
    ownQuery = ownQuery.where("occurredAt", ">=", range.monthStart).where("occurredAt", "<", range.monthEnd);
  }

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  const merged = [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });

  const categoriesById = await loadCategoriesMap(groupId);

  return merged
    .filter((doc) => {
      const data = doc.data();
      return data.isPrivate === false || data.createdBy === requestingUserId;
    })
    .sort((a, b) => {
      const occurredCompare = (b.data().occurredAt as string).localeCompare(a.data().occurredAt as string);
      if (occurredCompare !== 0) return occurredCompare;
      const aCreated = (a.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      const bCreated = (b.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      return bCreated - aCreated;
    })
    .slice(0, limit)
    .map((doc) => {
      const row = toTransactionRow(doc);
      const category = row.categoryId ? categoriesById.get(row.categoryId) : undefined;
      return { ...row, categoryName: category?.name ?? null, categoryEmoji: category?.emoji ?? null };
    });
}

export async function findTransactionById(transactionId: string): Promise<TransactionRow | null> {
  const doc = await transactionsCol.doc(transactionId).get();
  if (!doc.exists) return null;
  return toTransactionRow(doc);
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  await deleteSplitsForTransaction(transactionId);
  await transactionsCol.doc(transactionId).delete();
}

export async function updateTransaction(
  transactionId: string,
  fields: {
    description?: string;
    amount?: number;
    transactionType?: TransactionType;
    categoryId?: string | null;
    occurredAt?: string;
  }
): Promise<TransactionRow> {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.amount !== undefined) update.amountCents = toCents(fields.amount);
  if (fields.transactionType !== undefined) update.transactionType = fields.transactionType;
  if (fields.categoryId !== undefined) update.categoryId = fields.categoryId;
  if (fields.occurredAt !== undefined) update.occurredAt = fields.occurredAt;

  await transactionsCol.doc(transactionId).update(update);
  const doc = await transactionsCol.doc(transactionId).get();
  return toTransactionRow(doc);
}

export interface AccountBalanceRow {
  accountId: string;
  balanceCents: number;
}

// Net of income minus expense per account, computed fresh from the
// transaction log each time (no stored running balance -- see schema notes).
export async function getAccountBalances(groupId: string): Promise<AccountBalanceRow[]> {
  const snapshot = await transactionsCol.where("groupId", "==", groupId).select("accountId", "amountCents", "transactionType").get();
  const balances = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const delta = data.transactionType === "income" ? data.amountCents : -data.amountCents;
    balances.set(data.accountId, (balances.get(data.accountId) ?? 0) + delta);
  }
  return Array.from(balances.entries()).map(([accountId, balanceCents]) => ({ accountId, balanceCents }));
}

export interface CategorySummaryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

export interface PayerSummaryRow {
  payerId: string;
  total: string;
}

export type SummaryScope = "joint" | "visible";

// "joint": only what leaves "Nossa Conta" -- used by the Par page, which is
// specifically about the shared budget.
// "visible": joint + the requester's own personal account -- matches exactly
// what findTransactionsVisibleTo returns, so a page showing both a category
// breakdown and an extrato (Relatórios) never has one contradict the other.
async function fetchExpenseDocsForSummary(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint")
    .where("transactionType", "==", "expense")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  if (scope === "joint") {
    return (await jointQuery.get()).docs;
  }

  const ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId)
    .where("transactionType", "==", "expense")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  return [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

export async function getMonthlySummary(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope = "joint"
): Promise<{ byCategory: CategorySummaryRow[]; byPayer: PayerSummaryRow[]; total: string }> {
  const docs = await fetchExpenseDocsForSummary(groupId, requestingUserId, monthStart, monthEnd, scope);

  const categoriesById = await loadCategoriesMap(groupId);

  // Single pass over docs -- byCategory (privacy-gated), byPayer (ungated,
  // see comment below) and the running total all accumulate together instead
  // of three separate traversals of the same array.
  const byCategoryMap = new Map<string, { categoryId: string | null; total: number }>();
  const byPayerMap = new Map<string, number>();
  let totalCents = 0;

  for (const doc of docs) {
    const data = doc.data();
    totalCents += data.amountCents;
    byPayerMap.set(data.payerId, (byPayerMap.get(data.payerId) ?? 0) + data.amountCents);

    if (data.isPrivate === false || data.createdBy === requestingUserId) {
      const key = data.categoryId ?? "none";
      const entry = byCategoryMap.get(key) ?? { categoryId: data.categoryId ?? null, total: 0 };
      entry.total += data.amountCents;
      byCategoryMap.set(key, entry);
    }
  }
  const byCategory: CategorySummaryRow[] = Array.from(byCategoryMap.values())
    .map((entry) => {
      const category = entry.categoryId ? categoriesById.get(entry.categoryId) : undefined;
      return {
        categoryId: entry.categoryId,
        categoryName: category?.name ?? null,
        categoryEmoji: category?.emoji ?? null,
        total: fromCents(entry.total),
      };
    })
    .sort((a, b) => Number(b.total) - Number(a.total));

  // byPayer intentionally does NOT gate on isPrivate -- matches the original
  // SQL asymmetry (a couple's total spend-by-person is real even if one
  // entry's description is private).
  const byPayer: PayerSummaryRow[] = Array.from(byPayerMap.entries()).map(([payerId, total]) => ({
    payerId,
    total: fromCents(total),
  }));

  return { byCategory, byPayer, total: fromCents(totalCents) };
}

export interface DailySeriesPoint {
  day: string;
  income: string;
  expense: string;
}

// Same query shape as findTransactionsVisibleTo (groupId + accountType/
// accountOwnerId + occurredAt range, no transactionType filter) so it rides
// the composite indexes that already exist for the extrato -- no new index
// needed. Unlike fetchExpenseDocsForSummary this pulls both income and
// expense docs, since the daily series charts both.
async function fetchDocsForDailySeries(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  if (scope === "joint") {
    return (await jointQuery.get()).docs;
  }

  const ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId)
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  return [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

// Cumulative income/expense per day, from the 1st of the month through
// today (or through the month's last day, for a past month) -- one point
// per calendar day so the line has no gaps, carrying the running total
// forward on days with no transactions.
export async function getDailySeries(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope = "visible"
): Promise<DailySeriesPoint[]> {
  const docs = await fetchDocsForDailySeries(groupId, requestingUserId, monthStart, monthEnd, scope);

  const byDay = new Map<string, { income: number; expense: number }>();
  for (const doc of docs) {
    const data = doc.data();
    if (!(data.isPrivate === false || data.createdBy === requestingUserId)) continue;
    const entry = byDay.get(data.occurredAt) ?? { income: 0, expense: 0 };
    if (data.transactionType === "income") {
      entry.income += data.amountCents;
    } else {
      entry.expense += data.amountCents;
    }
    byDay.set(data.occurredAt, entry);
  }

  const monthEndDate = new Date(`${monthEnd}T00:00:00Z`);
  const todayDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const lastDate = todayDate < monthEndDate ? todayDate : new Date(monthEndDate.getTime() - 86_400_000);

  const points: DailySeriesPoint[] = [];
  let cumIncomeCents = 0;
  let cumExpenseCents = 0;
  for (
    const cursor = new Date(`${monthStart}T00:00:00Z`);
    cursor <= lastDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    const entry = byDay.get(day);
    if (entry) {
      cumIncomeCents += entry.income;
      cumExpenseCents += entry.expense;
    }
    points.push({ day, income: fromCents(cumIncomeCents), expense: fromCents(cumExpenseCents) });
  }
  return points;
}

export interface BalanceRow {
  paidBy: string;
  owedBy: string;
  totalOwed: string;
}

// "Who owes whom", computed fresh from transactions+splits (was a SQL VIEW;
// this is the same derivation, just done in Node since Firestore has no
// server-side aggregation). Not currently surfaced in any UI.
export async function getBalanceRows(groupId: string): Promise<BalanceRow[]> {
  const txSnapshot = await transactionsCol
    .where("groupId", "==", groupId)
    .where("transactionType", "==", "expense")
    .select("payerId")
    .get();
  const payerByTx = new Map(txSnapshot.docs.map((doc) => [doc.id, doc.data().payerId as string]));
  if (payerByTx.size === 0) return [];

  const splitsSnapshot = await db.collectionGroup("splits").where("groupId", "==", groupId).get();

  const pairTotals = new Map<string, number>();
  for (const doc of splitsSnapshot.docs) {
    const data = doc.data();
    const paidBy = payerByTx.get(data.transactionId);
    if (!paidBy || data.userId === paidBy) continue;
    const key = `${paidBy}__${data.userId}`;
    pairTotals.set(key, (pairTotals.get(key) ?? 0) + data.shareAmountCents);
  }

  return Array.from(pairTotals.entries()).map(([key, cents]) => {
    const [paidBy, owedBy] = key.split("__");
    return { paidBy, owedBy, totalOwed: fromCents(cents) };
  });
}
