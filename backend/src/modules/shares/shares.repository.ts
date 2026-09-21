import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface ShareTransaction {
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  occurredAt: string;
  categoryName: string | null;
  categoryEmoji: string | null;
  paymentMethod: string | null;
}

export interface ShareCategoryTotal {
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

// A frozen copy of the month at the moment the link was made. Public reads
// never touch the live transactions collection: what the link shows cannot
// change afterwards and nothing beyond this document is reachable through it.
export interface ShareSnapshot {
  month: string;
  ownerName: string;
  totalIncome: string;
  totalExpense: string;
  byCategory: ShareCategoryTotal[];
  transactions: ShareTransaction[];
}

export interface ShareRow extends ShareSnapshot {
  id: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const sharesCol = db.collection("shares");

function toShareRow(doc: FirebaseFirestore.DocumentSnapshot): ShareRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    ownerId: data.ownerId,
    month: data.month,
    ownerName: data.ownerName,
    totalIncome: data.totalIncome,
    totalExpense: data.totalExpense,
    byCategory: data.byCategory,
    transactions: data.transactions,
    createdAt: data.createdAt.toDate().toISOString(),
    expiresAt: data.expiresAt.toDate().toISOString(),
    revokedAt: data.revokedAt ? data.revokedAt.toDate().toISOString() : null,
  };
}

// The document id IS the secret token (unguessable random string), so a
// lookup by token is a direct get: no query, no index.
export async function insertShare(
  token: string,
  input: ShareSnapshot & { ownerId: string; expiresAt: Date }
): Promise<ShareRow> {
  const ref = sharesCol.doc(token);
  await ref.set({
    ownerId: input.ownerId,
    month: input.month,
    ownerName: input.ownerName,
    totalIncome: input.totalIncome,
    totalExpense: input.totalExpense,
    byCategory: input.byCategory,
    transactions: input.transactions,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: input.expiresAt,
    revokedAt: null,
  });
  return toShareRow(await ref.get());
}

export async function findShareByToken(token: string): Promise<ShareRow | null> {
  const doc = await sharesCol.doc(token).get();
  return doc.exists ? toShareRow(doc) : null;
}

export async function markShareRevoked(token: string): Promise<void> {
  await sharesCol.doc(token).update({ revokedAt: FieldValue.serverTimestamp() });
}
