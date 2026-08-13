import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";
import { currentMonthParam, monthParamFromDate } from "../../utils/month";
import { deleteTransaction } from "../transactions/transactions.repository";

export interface DebtRow {
  id: string;
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
  startMonth: string;
}

export interface DebtInstallmentRow {
  id: string;
  debtId: string;
  installmentNumber: number;
  amount: string;
  isPaid: boolean;
  paidAt: string | null;
  transactionId: string | null;
  referenceMonth: string;
}

const debtsCol = db.collection("debts");

// startMonth/referenceMonth didn't exist before the debt-cycle feature, so
// debts/installments created before that still have these fields missing in
// Firestore -- default them instead of returning undefined, which would
// otherwise crash the frontend's month formatting on old data.
function toDebtRow(doc: FirebaseFirestore.DocumentSnapshot): DebtRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    ownerUserId: data.ownerUserId ?? null,
    createdBy: data.createdBy,
    name: data.name,
    description: data.description ?? null,
    totalAmount: fromCents(data.totalAmountCents),
    installmentsCount: data.installmentsCount,
    startMonth: data.startMonth ?? currentMonthParam(),
  };
}

function toInstallmentRow(debtId: string, doc: FirebaseFirestore.DocumentSnapshot): DebtInstallmentRow {
  const data = doc.data()!;
  const paidAtDate: Date | null = data.paidAt ? data.paidAt.toDate() : null;
  return {
    id: doc.id,
    debtId,
    installmentNumber: data.installmentNumber,
    amount: fromCents(data.amountCents),
    isPaid: data.isPaid ?? false,
    paidAt: paidAtDate ? paidAtDate.toISOString() : null,
    transactionId: data.transactionId ?? null,
    referenceMonth: data.referenceMonth ?? (paidAtDate ? monthParamFromDate(paidAtDate) : currentMonthParam()),
  };
}

export async function insertDebt(input: {
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  description: string | null;
  totalAmount: number;
  installmentsCount: number;
  startMonth: string;
}): Promise<DebtRow> {
  const ref = await debtsCol.add({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    name: input.name,
    description: input.description,
    totalAmountCents: toCents(input.totalAmount),
    installmentsCount: input.installmentsCount,
    startMonth: input.startMonth,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toDebtRow(doc);
}

// Doc ID = String(installmentNumber) -- matches SQL's
// UNIQUE(debt_id, installment_number). installmentNumber is also stored as
// a field since a string doc-ID sort would order "10" before "2".
// Each installment gets its own referenceMonth ("competência") so marking
// it paid always books against that month regardless of the real day the
// user actually clicks it -- installment N defaults to startMonth + (N-1).
export async function insertInstallments(
  debtId: string,
  installments: { amountCents: number; referenceMonth: string }[]
): Promise<void> {
  const installmentsCol = debtsCol.doc(debtId).collection("installments");
  const batch = db.batch();
  installments.forEach(({ amountCents, referenceMonth }, index) => {
    batch.set(installmentsCol.doc(String(index + 1)), {
      installmentNumber: index + 1,
      amountCents,
      referenceMonth,
      isPaid: false,
      paidAt: null,
      transactionId: null,
    });
  });
  await batch.commit();
}

export async function findDebtsVisibleTo(groupId: string, userId: string): Promise<DebtRow[]> {
  const [jointSnap, ownSnap] = await Promise.all([
    debtsCol.where("groupId", "==", groupId).where("ownerUserId", "==", null).get(),
    debtsCol.where("groupId", "==", groupId).where("ownerUserId", "==", userId).get(),
  ]);
  return [...jointSnap.docs, ...ownSnap.docs]
    .map(toDebtRow)
    .sort((a, b) => (a.id < b.id ? 1 : -1));
}

export async function findInstallmentsByDebtIds(debtIds: string[]): Promise<DebtInstallmentRow[]> {
  if (debtIds.length === 0) return [];
  const results = await Promise.all(
    debtIds.map(async (debtId) => {
      const snapshot = await debtsCol.doc(debtId).collection("installments").orderBy("installmentNumber").get();
      return snapshot.docs.map((doc) => toInstallmentRow(debtId, doc));
    })
  );
  return results.flat();
}

export async function findDebtById(debtId: string): Promise<DebtRow | null> {
  const doc = await debtsCol.doc(debtId).get();
  if (!doc.exists) return null;
  return toDebtRow(doc);
}

export async function findInstallmentById(
  debtId: string,
  installmentId: string
): Promise<DebtInstallmentRow | null> {
  const doc = await debtsCol.doc(debtId).collection("installments").doc(installmentId).get();
  if (!doc.exists) return null;
  return toInstallmentRow(debtId, doc);
}

export async function setInstallmentPaid(
  debtId: string,
  installmentId: string,
  isPaid: boolean,
  transactionId: string | null
): Promise<DebtInstallmentRow> {
  const ref = debtsCol.doc(debtId).collection("installments").doc(installmentId);
  await ref.update({ isPaid, paidAt: isPaid ? FieldValue.serverTimestamp() : null, transactionId });
  const doc = await ref.get();
  return toInstallmentRow(debtId, doc);
}

export async function updateInstallmentReferenceMonth(
  debtId: string,
  installmentId: string,
  referenceMonth: string
): Promise<DebtInstallmentRow> {
  const ref = debtsCol.doc(debtId).collection("installments").doc(installmentId);
  await ref.update({ referenceMonth });
  const doc = await ref.get();
  return toInstallmentRow(debtId, doc);
}

export async function updateDebt(
  debtId: string,
  input: { name: string; description: string | null }
): Promise<DebtRow> {
  const ref = debtsCol.doc(debtId);
  await ref.update({
    name: input.name,
    description: input.description,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toDebtRow(doc);
}

export async function deleteDebt(debtId: string): Promise<void> {
  const installmentsSnapshot = await debtsCol.doc(debtId).collection("installments").get();
  const linkedTransactionIds = installmentsSnapshot.docs
    .map((doc) => doc.data().transactionId as string | null)
    .filter((id): id is string => Boolean(id));

  const batch = db.batch();
  installmentsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(debtsCol.doc(debtId));
  await batch.commit();

  // Removes the auto-generated expenses along with the debt they belong to,
  // instead of leaving orphaned transactions in the extrato.
  await Promise.all(linkedTransactionIds.map((transactionId) => deleteTransaction(transactionId)));
}
