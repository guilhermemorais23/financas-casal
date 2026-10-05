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
// Como é o valor da conta:
// - fixed: sabe quanto é (aluguel, assinatura) -- lança sozinha no dia.
// - estimate: varia (água, luz) -- `amount` é a estimativa; não lança
//   sozinha, a pessoa confirma o valor real ("Já paguei").
// - unknown: não sabe ainda (celular) -- `amount` é null; só lembra.
export const AMOUNT_MODES = ["fixed", "estimate", "unknown"] as const;
export type AmountMode = (typeof AMOUNT_MODES)[number];

// Com quantos dias de antecedência avisar (Painel + notificação).
export const REMIND_DAYS = [0, 1, 3, 7] as const;
export const DEFAULT_REMIND_DAYS = 3;

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
  // null só quando amountMode é "unknown".
  amount: string | null;
  amountMode: AmountMode;
  remindDaysBefore: number;
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
  // Contas sem valor certo: primeiro mês que conta ("YYYY-MM"). Antes dele
  // não há o que pagar (a conta foi criada depois do vencimento do mês).
  startMonth: string | null;
  // "Me lembre mais tarde": vale só pro mês pendente (snoozedMonth). Ou até
  // uma data, ou até o salário cair (snoozeSalarySince = desde quando
  // esperar uma receita de quem adiou, snoozedBy).
  snoozedMonth: string | null;
  snoozedUntil: string | null;
  snoozeSalarySince: string | null;
  snoozedBy: string | null;
  // Últimos valores reais pagos (centavos, mais antigo primeiro, até 3): a
  // estimativa passa a ser a média deles.
  recentAmountsCents: number[];
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
    amount: typeof data.amountCents === "number" ? fromCents(data.amountCents) : null,
    amountMode: AMOUNT_MODES.includes(data.amountMode) ? data.amountMode : "fixed",
    remindDaysBefore: typeof data.remindDaysBefore === "number" ? data.remindDaysBefore : DEFAULT_REMIND_DAYS,
    transactionType: data.transactionType,
    isPrivate: data.isPrivate ?? false,
    splitType: data.splitType ?? "none",
    dayOfMonth: data.dayOfMonth,
    isActive: data.isActive ?? true,
    lastGeneratedMonth: data.lastGeneratedMonth ?? null,
    startMonth: data.startMonth ?? null,
    snoozedMonth: data.snoozedMonth ?? null,
    snoozedUntil: data.snoozedUntil ?? null,
    snoozeSalarySince: data.snoozeSalarySince ?? null,
    snoozedBy: data.snoozedBy ?? null,
    recentAmountsCents: Array.isArray(data.recentAmountsCents) ? data.recentAmountsCents.filter((n: unknown) => typeof n === "number") : [],
  };
}

export { toRow as toRecurringBillRow };

export function recurringBillRef(id: string): FirebaseFirestore.DocumentReference {
  return recurringBillsCol.doc(id);
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
  amount: number | null;
  amountMode: AmountMode;
  remindDaysBefore: number;
  startMonth: string | null;
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
    amountCents: input.amount === null ? null : toCents(input.amount),
    amountMode: input.amountMode,
    remindDaysBefore: input.remindDaysBefore,
    startMonth: input.startMonth,
    recentAmountsCents: [],
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
    amount?: number | null;
    amountMode?: AmountMode;
    remindDaysBefore?: number;
    startMonth?: string | null;
    dayOfMonth?: number;
    categoryId?: string | null;
    isActive?: boolean;
  }
): Promise<RecurringBillRow> {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.amount !== undefined) update.amountCents = fields.amount === null ? null : toCents(fields.amount);
  if (fields.amountMode !== undefined) update.amountMode = fields.amountMode;
  if (fields.remindDaysBefore !== undefined) update.remindDaysBefore = fields.remindDaysBefore;
  if (fields.startMonth !== undefined) update.startMonth = fields.startMonth;
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

// "Me lembre mais tarde" do mês pendente.
export async function setRecurringBillSnooze(
  id: string,
  snooze: { month: string; until: string | null; salarySince: string | null; by: string }
): Promise<void> {
  await recurringBillsCol.doc(id).update({
    snoozedMonth: snooze.month,
    snoozedUntil: snooze.until,
    snoozeSalarySince: snooze.salarySince,
    snoozedBy: snooze.by,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteRecurringBill(id: string): Promise<void> {
  await recurringBillsCol.doc(id).delete();
}
