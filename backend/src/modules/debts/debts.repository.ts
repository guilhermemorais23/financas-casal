import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
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
  // Dia do mês em que cada parcela vence ("vence todo dia 10"), ou null numa
  // dívida criada antes disto existir, ou quando a pessoa não sabe/não liga
  // pro dia exato. Opcional de propósito -- diferente dos cartões (onde
  // closingDay/dueDay movem toda a conta do ciclo da fatura), a parcela de uma
  // dívida já entra num mês de verdade pelo referenceMonth, com ou sem dueDay.
  dueDay: number | null;
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

// startMonth/referenceMonth não existiam antes do ciclo das dívidas, então
// dívidas e parcelas criadas antes disso não têm esses campos no Firestore --
// aqui vira um valor padrão em vez de undefined, que quebraria a formatação
// de mês do frontend nos dados antigos.
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
    dueDay: data.dueDay ?? null,
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
  dueDay: number | null;
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
    dueDay: input.dueDay,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toDebtRow(doc);
}

// ID do documento = String(installmentNumber) -- equivale ao
// UNIQUE(debt_id, installment_number) do SQL. O installmentNumber também é
// guardado como campo, porque ordenar o ID como texto poria "10" antes de "2".
// Cada parcela tem o próprio referenceMonth ("competência"), então marcar
// como paga sempre lança naquele mês, não importa o dia real em que a pessoa
// clica -- a parcela N fica, por padrão, em startMonth + (N-1).
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

// Todas as dívidas do grupo, de qualquer dono -- diferente do
// findDebtsVisibleTo, não se limita "ao que um usuário pode ver" (um filtro de
// igualdade só, sem índice novo). Usado pelo job de lembretes, pelo mesmo
// motivo do findCardsByGroupId do cards.repository.
export function findDebtsByGroupId(groupId: string): Promise<DebtRow[]> {
  return memoizeScoped(`debts:${groupId}`, [`group:${groupId}`, "debts"], () => loadFindDebtsByGroupId(groupId));
}

async function loadFindDebtsByGroupId(groupId: string): Promise<DebtRow[]> {
  const snapshot = await debtsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toDebtRow);
}

export function findInstallmentsByDebtIds(debtIds: string[]): Promise<DebtInstallmentRow[]> {
  return memoizeScoped(`installments:${[...debtIds].sort().join(",")}`, ["debts"], () => loadFindInstallmentsByDebtIds(debtIds));
}

async function loadFindInstallmentsByDebtIds(debtIds: string[]): Promise<DebtInstallmentRow[]> {
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

export function installmentRef(debtId: string, installmentId: string): FirebaseFirestore.DocumentReference {
  return debtsCol.doc(debtId).collection("installments").doc(installmentId);
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
  input: { name: string; description: string | null; dueDay?: number | null }
): Promise<DebtRow> {
  const ref = debtsCol.doc(debtId);
  const update: Record<string, unknown> = {
    name: input.name,
    description: input.description,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.dueDay !== undefined) update.dueDay = input.dueDay;
  await ref.update(update);
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

  // Apaga os gastos gerados junto com a dívida a que pertencem, em vez de
  // deixar lançamentos órfãos no extrato.
  await Promise.all(linkedTransactionIds.map((transactionId) => deleteTransaction(transactionId)));
}
