import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";
import type { SplitType, TransactionType } from "../transactions/transactions.repository";

// "Aluguel/assinaturas" -- unlike a transaction's recurringMonths (which
// generates a fixed batch of occurrences up front, see
// transactions.service.ts), a bill here is a standing definition with no end
// date: the daily cron (generateDueRecurringBills) creates one real
// transaction from it whenever its day comes around, month after month,
// until someone pauses or deletes it.
export interface RecurringBillRow {
  id: string;
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  createdBy: string;
  payerId: string;
  categoryId: string | null;
  description: string;
  amount: string;
  transactionType: TransactionType;
  isPrivate: boolean;
  splitType: SplitType;
  dayOfMonth: number;
  isActive: boolean;
  // "YYYY-MM" of the last month a transaction was actually generated for
  // this bill (or attempted -- see generateDueRecurringBills), or null if
  // it has never fired yet. The cron's dedupe key: never generate twice for
  // the same calendar month even if it runs more than once a day.
  lastGeneratedMonth: string | null;
}

const recurringBillsCol = db.collection("recurringBills");

function toRow(doc: FirebaseFirestore.DocumentSnapshot): RecurringBillRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    accountId: data.accountId,
    accountType: data.accountType,
    accountOwnerId: data.accountOwnerId ?? null,
    createdBy: data.createdBy,
    payerId: data.payerId,
    categoryId: data.categoryId ?? null,
    description: data.description,
    amount: fromCents(data.amountCents),
    transactionType: data.transactionType,
    isPrivate: data.isPrivate ?? false,
    splitType: data.splitType ?? "none",
    dayOfMonth: data.dayOfMonth,
    isActive: data.isActive ?? true,
    lastGeneratedMonth: data.lastGeneratedMonth ?? null,
  };
}

export async function insertRecurringBill(input: {
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  createdBy: string;
  payerId: string;
  categoryId: string | null;
  description: string;
  amount: number;
  transactionType: TransactionType;
  isPrivate: boolean;
  splitType: SplitType;
  dayOfMonth: number;
}): Promise<RecurringBillRow> {
  const ref = await recurringBillsCol.add({
    groupId: input.groupId,
    accountId: input.accountId,
    accountType: input.accountType,
    accountOwnerId: input.accountOwnerId,
    createdBy: input.createdBy,
    payerId: input.payerId,
    categoryId: input.categoryId,
    description: input.description,
    amountCents: toCents(input.amount),
    transactionType: input.transactionType,
    isPrivate: input.isPrivate,
    splitType: input.splitType,
    dayOfMonth: input.dayOfMonth,
    isActive: true,
    lastGeneratedMonth: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toRow(doc);
}

export async function findRecurringBillById(id: string): Promise<RecurringBillRow | null> {
  const doc = await recurringBillsCol.doc(id).get();
  return doc.exists ? toRow(doc) : null;
}

// Group-scoped, for the user-facing list -- service layer applies the
// personal/joint visibility split on top (same split every other
// group-scoped list in the app uses).
export async function findRecurringBillsByGroupId(groupId: string): Promise<RecurringBillRow[]> {
  const snapshot = await recurringBillsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toRow);
}

// Cron-only: every active bill across every group in one query (single
// equality filter, no composite index needed) -- there's no "requesting
// user" here to scope by group first, same shape as
// reminders.repository.findAllGroupIds.
export async function findAllActiveRecurringBills(): Promise<RecurringBillRow[]> {
  const snapshot = await recurringBillsCol.where("isActive", "==", true).get();
  return snapshot.docs.map(toRow);
}

export async function updateRecurringBill(
  id: string,
  fields: {
    description?: string;
    amount?: number;
    dayOfMonth?: number;
    categoryId?: string | null;
    isActive?: boolean;
  }
): Promise<RecurringBillRow> {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.amount !== undefined) update.amountCents = toCents(fields.amount);
  if (fields.dayOfMonth !== undefined) update.dayOfMonth = fields.dayOfMonth;
  if (fields.categoryId !== undefined) update.categoryId = fields.categoryId;
  if (fields.isActive !== undefined) update.isActive = fields.isActive;

  await recurringBillsCol.doc(id).update(update);
  const doc = await recurringBillsCol.doc(id).get();
  return toRow(doc);
}

export async function markRecurringBillGenerated(id: string, month: string): Promise<void> {
  await recurringBillsCol.doc(id).update({ lastGeneratedMonth: month });
}

export async function deleteRecurringBill(id: string): Promise<void> {
  await recurringBillsCol.doc(id).delete();
}
