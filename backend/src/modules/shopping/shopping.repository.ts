import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface ShoppingItemRow {
  id: string;
  groupId: string;
  name: string;
  isChecked: boolean;
  checkedBy: string | null;
  transactionId: string | null;
  createdBy: string;
  createdAt: string;
}

const itemsCol = db.collection("shoppingItems");

function toItemRow(doc: FirebaseFirestore.DocumentSnapshot): ShoppingItemRow {
  const data = doc.data()!;
  const createdAt = data.createdAt as FirebaseFirestore.Timestamp | undefined;
  return {
    id: doc.id,
    groupId: data.groupId,
    name: data.name,
    isChecked: data.isChecked ?? false,
    checkedBy: data.checkedBy ?? null,
    transactionId: data.transactionId ?? null,
    createdBy: data.createdBy,
    createdAt: createdAt ? createdAt.toDate().toISOString() : new Date(0).toISOString(),
  };
}

export async function insertItem(input: {
  groupId: string;
  name: string;
  createdBy: string;
}): Promise<ShoppingItemRow> {
  const ref = await itemsCol.add({
    groupId: input.groupId,
    name: input.name,
    isChecked: false,
    checkedBy: null,
    transactionId: null,
    createdBy: input.createdBy,
    createdAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toItemRow(doc);
}

// One shared list per group -- unlike accounts/debts/cards there's no
// personal/joint split here, the whole point is everyone sees the same list.
export async function findItemsByGroupId(groupId: string): Promise<ShoppingItemRow[]> {
  const snapshot = await itemsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toItemRow).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findItemById(itemId: string): Promise<ShoppingItemRow | null> {
  const doc = await itemsCol.doc(itemId).get();
  if (!doc.exists) return null;
  return toItemRow(doc);
}

export async function setItemChecked(
  itemId: string,
  isChecked: boolean,
  checkedBy: string | null,
  transactionId: string | null
): Promise<ShoppingItemRow> {
  const ref = itemsCol.doc(itemId);
  await ref.update({ isChecked, checkedBy, transactionId });
  const doc = await ref.get();
  return toItemRow(doc);
}

export async function deleteItem(itemId: string): Promise<void> {
  await itemsCol.doc(itemId).delete();
}
