import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, splitEvenly, toCents } from "../../utils/money";

export interface CardRow {
  id: string;
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  closingDay: number;
  dueDay: number;
  // Optional on purpose -- a card someone already had before this existed
  // keeps working exactly as it did, with no limit bar shown at all, until
  // they fill one in themselves.
  limit: string | null;
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
  // A purchase made at once (installmentsCount === 1) or the Nth of a
  // parcelado one -- every installment of the same original purchase shares
  // purchaseGroupId, one doc per statement month it lands in (same pattern
  // as transactions' recurringGroupId). Deleting one installment only
  // deletes that doc, on purpose -- see removePurchase in cards.service.ts.
  installmentNumber: number;
  installmentsCount: number;
  purchaseGroupId: string;
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
    limit: typeof data.limitCents === "number" ? fromCents(data.limitCents) : null,
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
    // Purchases created before parcelamento existed have neither field --
    // treat every one of those as its own 1/1 purchase.
    installmentNumber: data.installmentNumber ?? 1,
    installmentsCount: data.installmentsCount ?? 1,
    purchaseGroupId: data.purchaseGroupId ?? doc.id,
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
  limit: number | null;
}): Promise<CardRow> {
  const ref = await cardsCol.add({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    limitCents: input.limit !== null ? toCents(input.limit) : null,
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
  input: { name: string; closingDay: number; dueDay: number; limit?: number | null }
): Promise<CardRow> {
  const ref = cardsCol.doc(cardId);
  const update: Record<string, unknown> = {
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.limit !== undefined) {
    update.limitCents = input.limit !== null ? toCents(input.limit) : null;
  }
  await ref.update(update);
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

// A parcela 1/N posts to `statementMonth` (the month the purchase date
// itself falls into); parcela 2/N to the next month, and so on -- every
// installment shares one amount split via splitEvenly (same utility debts
// use), and one purchaseGroupId. count === 1 is the plain, unparcelled case
// and produces exactly one doc, same as the old insertPurchase did.
export async function insertPurchaseSeries(
  cardId: string,
  input: {
    description: string;
    amount: number;
    categoryId: string | null;
    buyerId: string;
    purchaseDate: string;
    count: number;
  },
  statementMonthsForEachInstallment: string[]
): Promise<PurchaseRow[]> {
  const col = cardsCol.doc(cardId).collection("purchases");
  const refs = statementMonthsForEachInstallment.map(() => col.doc());
  const purchaseGroupId = refs[0].id;
  const shares = splitEvenly(input.amount, input.count);

  const batch = db.batch();
  refs.forEach((ref, index) => {
    batch.set(ref, {
      description: input.description,
      // splitEvenly already returns cents, unlike every other money field
      // here (which take reais and convert with toCents) -- no double
      // conversion.
      amountCents: shares[index],
      categoryId: input.categoryId,
      buyerId: input.buyerId,
      purchaseDate: input.purchaseDate,
      statementMonth: statementMonthsForEachInstallment[index],
      installmentNumber: index + 1,
      installmentsCount: input.count,
      purchaseGroupId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  const docs = await Promise.all(refs.map((ref) => ref.get()));
  return docs.map((doc) => toPurchaseRow(cardId, doc));
}

// Every purchase on a card, any statement month -- used to compute how much
// of the limit is currently locked (every installment not yet paid off,
// which can span several months into the future). Cheap: a card's whole
// purchase history tops out in the hundreds of docs, not worth a
// per-month-range query for this.
export async function findAllPurchasesByCardId(cardId: string): Promise<PurchaseRow[]> {
  const snapshot = await cardsCol.doc(cardId).collection("purchases").get();
  return snapshot.docs.map((doc) => toPurchaseRow(cardId, doc));
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
