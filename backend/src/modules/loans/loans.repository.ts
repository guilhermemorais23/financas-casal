import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";

export type LoanStatus = "open" | "paid" | "forgiven";

export interface RepaymentRow {
  id: string;
  amount: string;
  receivedAt: string;
  // Where the money came back into (null = received outside the app, just
  // noted) and the transfer transaction booked for it.
  accountId: string | null;
  transactionId: string | null;
}

export interface LoanRow {
  id: string;
  groupId: string;
  ownerUserId: string;
  personName: string;
  amount: string;
  lentAt: string;
  // No deadline is a normal case ("me paga quando der").
  dueDate: string | null;
  note: string | null;
  // Account the money left from (null = lent before using the app / not
  // from a tracked account -- nothing was booked).
  accountId: string | null;
  transactionId: string | null;
  repayments: RepaymentRow[];
  status: LoanStatus;
}

const loansCol = db.collection("loans");

interface StoredRepayment {
  id: string;
  amountCents: number;
  receivedAt: string;
  accountId: string | null;
  transactionId: string | null;
}

function toLoanRow(doc: FirebaseFirestore.DocumentSnapshot): LoanRow {
  const data = doc.data()!;
  const repayments = ((data.repayments ?? []) as StoredRepayment[]).map((r) => ({
    id: r.id,
    amount: fromCents(r.amountCents),
    receivedAt: r.receivedAt,
    accountId: r.accountId ?? null,
    transactionId: r.transactionId ?? null,
  }));
  return {
    id: doc.id,
    groupId: data.groupId,
    ownerUserId: data.ownerUserId,
    personName: data.personName,
    amount: fromCents(data.amountCents),
    lentAt: data.lentAt,
    dueDate: data.dueDate ?? null,
    note: data.note ?? null,
    accountId: data.accountId ?? null,
    transactionId: data.transactionId ?? null,
    repayments,
    status: data.status ?? "open",
  };
}

export function newLoanId(): string {
  return loansCol.doc().id;
}

export async function insertLoan(
  id: string,
  input: Omit<LoanRow, "id" | "repayments" | "status" | "amount"> & { amount: number }
): Promise<LoanRow> {
  const ref = loansCol.doc(id);
  await ref.set({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    personName: input.personName,
    amountCents: toCents(input.amount),
    lentAt: input.lentAt,
    dueDate: input.dueDate,
    note: input.note,
    accountId: input.accountId,
    transactionId: input.transactionId,
    repayments: [],
    status: "open",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return toLoanRow(await ref.get());
}

export async function findLoanById(id: string): Promise<LoanRow | null> {
  const doc = await loansCol.doc(id).get();
  return doc.exists ? toLoanRow(doc) : null;
}

export async function findLoansByOwner(groupId: string, ownerUserId: string): Promise<LoanRow[]> {
  const snapshot = await loansCol.where("groupId", "==", groupId).where("ownerUserId", "==", ownerUserId).get();
  return snapshot.docs.map(toLoanRow);
}

export async function updateLoan(
  id: string,
  patch: Partial<{
    personName: string;
    dueDate: string | null;
    note: string | null;
    status: LoanStatus;
    repayments: RepaymentRow[];
  }>
): Promise<LoanRow> {
  const { repayments, ...rest } = patch;
  const data: Record<string, unknown> = { ...rest, updatedAt: FieldValue.serverTimestamp() };
  if (repayments) {
    data.repayments = repayments.map((r) => ({
      id: r.id,
      amountCents: toCents(Number(r.amount)),
      receivedAt: r.receivedAt,
      accountId: r.accountId,
      transactionId: r.transactionId,
    }));
  }
  const ref = loansCol.doc(id);
  await ref.update(data);
  return toLoanRow(await ref.get());
}

export async function deleteLoan(id: string): Promise<void> {
  await loansCol.doc(id).delete();
}
