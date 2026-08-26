import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";

export interface CardRow {
  id: string;
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  closingDay: number;
  dueDay: number;
}

export interface PurchaseRow {
  id: string;
  cardId: string;
  description: string;
  amount: string;
  categoryId: string | null;
  buyerId: string;
  purchaseDate: string;
  statementMonth: string;
}

export interface StatementRow {
  isPaid: boolean;
  paidAt: string | null;
  transactionId: string | null;
}

const cardsCol = db.collection("cards");

function toCardRow(doc: FirebaseFirestore.DocumentSnapshot): CardRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    ownerUserId: data.ownerUserId ?? null,
    createdBy: data.createdBy,
    name: data.name,
    closingDay: data.closingDay,
    dueDay: data.dueDay,
  };
}

function toPurchaseRow(cardId: string, doc: FirebaseFirestore.DocumentSnapshot): PurchaseRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    cardId,
    description: data.description,
    amount: fromCents(data.amountCents),
    categoryId: data.categoryId ?? null,
    buyerId: data.buyerId,
    purchaseDate: data.purchaseDate,
    statementMonth: data.statementMonth,
  };
}

function toStatementRow(doc: FirebaseFirestore.DocumentSnapshot): StatementRow {
  const data = doc.data();
  return {
    isPaid: data?.isPaid ?? false,
    paidAt: data?.paidAt ? data.paidAt.toDate().toISOString() : null,
    transactionId: data?.transactionId ?? null,
  };
}

export async function insertCard(input: {
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  closingDay: number;
  dueDay: number;
}): Promise<CardRow> {
  const ref = await cardsCol.add({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toCardRow(doc);
}

export async function findCardsVisibleTo(groupId: string, userId: string): Promise<CardRow[]> {
  const [jointSnap, ownSnap] = await Promise.all([
    cardsCol.where("groupId", "==", groupId).where("ownerUserId", "==", null).get(),
    cardsCol.where("groupId", "==", groupId).where("ownerUserId", "==", userId).get(),
  ]);
  return [...jointSnap.docs, ...ownSnap.docs].map(toCardRow).sort((a, b) => (a.id < b.id ? 1 : -1));
}

// Every card in the group regardless of owner -- unlike findCardsVisibleTo
// this isn't scoped to "what one user can see" (a single equality filter,
// no new index). Used by the reminders job, which runs outside any one
// user's request and decides per-card who to email based on ownerUserId
// itself (null -> everyone in the group, set -> just that owner).
export async function findCardsByGroupId(groupId: string): Promise<CardRow[]> {
  const snapshot = await cardsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toCardRow);
}

export async function findCardById(cardId: string): Promise<CardRow | null> {
  const doc = await cardsCol.doc(cardId).get();
  if (!doc.exists) return null;
  return toCardRow(doc);
}

export async function updateCard(
  cardId: string,
  input: { name: string; closingDay: number; dueDay: number }
): Promise<CardRow> {
  const ref = cardsCol.doc(cardId);
  await ref.update({
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toCardRow(doc);
}

export async function deleteCard(cardId: string): Promise<string[]> {
  const purchasesSnap = await cardsCol.doc(cardId).collection("purchases").get();
  const statementsSnap = await cardsCol.doc(cardId).collection("statements").get();
  const linkedTransactionIds = statementsSnap.docs
    .map((doc) => doc.data().transactionId as string | null)
    .filter((id): id is string => Boolean(id));

  const batch = db.batch();
  purchasesSnap.docs.forEach((doc) => batch.delete(doc.ref));
  statementsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(cardsCol.doc(cardId));
  await batch.commit();

  return linkedTransactionIds;
}

export async function insertPurchase(
  cardId: string,
  input: {
    description: string;
    amount: number;
    categoryId: string | null;
    buyerId: string;
    purchaseDate: string;
    statementMonth: string;
  }
): Promise<PurchaseRow> {
  const ref = await cardsCol.doc(cardId).collection("purchases").add({
    description: input.description,
    amountCents: toCents(input.amount),
    categoryId: input.categoryId,
    buyerId: input.buyerId,
    purchaseDate: input.purchaseDate,
    statementMonth: input.statementMonth,
    createdAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toPurchaseRow(cardId, doc);
}

export async function findPurchasesByCardAndStatement(
  cardId: string,
  statementMonth: string
): Promise<PurchaseRow[]> {
  const snapshot = await cardsCol
    .doc(cardId)
    .collection("purchases")
    .where("statementMonth", "==", statementMonth)
    .get();
  return snapshot.docs
    .map((doc) => toPurchaseRow(cardId, doc))
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
}

export async function findPurchaseById(cardId: string, purchaseId: string): Promise<PurchaseRow | null> {
  const doc = await cardsCol.doc(cardId).collection("purchases").doc(purchaseId).get();
  if (!doc.exists) return null;
  return toPurchaseRow(cardId, doc);
}

export async function deletePurchase(cardId: string, purchaseId: string): Promise<void> {
  await cardsCol.doc(cardId).collection("purchases").doc(purchaseId).delete();
}

export async function findStatement(cardId: string, statementMonth: string): Promise<StatementRow | null> {
  const doc = await cardsCol.doc(cardId).collection("statements").doc(statementMonth).get();
  if (!doc.exists) return null;
  return toStatementRow(doc);
}

export async function setStatementPaid(
  cardId: string,
  statementMonth: string,
  isPaid: boolean,
  transactionId: string | null
): Promise<StatementRow> {
  const ref = cardsCol.doc(cardId).collection("statements").doc(statementMonth);
  await ref.set(
    { isPaid, paidAt: isPaid ? FieldValue.serverTimestamp() : null, transactionId },
    { merge: true }
  );
  const doc = await ref.get();
  return toStatementRow(doc);
}
