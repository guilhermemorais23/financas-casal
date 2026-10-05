import { db } from "../../db/firestore";

// Uma conexão do Pluggy (item) por documento: de quem é e até quando já
// foi importado em cada conta do banco.
export interface OpenFinanceItem {
  itemId: string;
  userId: string;
  groupId: string;
  connectorName: string;
  createdAt: number;
  // accountId do Pluggy -> última data (AAAA-MM-DD) já importada.
  syncedUntil: Record<string, string>;
  // Lançamentos no banco depois do syncedUntil, contados quando o Pluggy
  // avisa (webhook). notified = total que já virou notificação.
  pending?: { accounts: Record<string, number>; total: number; notified: number; updatedAt: number };
}

const col = db.collection("openFinanceItems");

export async function saveItem(item: OpenFinanceItem): Promise<void> {
  await col.doc(item.itemId).set(item);
}

export async function findItem(itemId: string): Promise<OpenFinanceItem | null> {
  if (!itemId || itemId.includes("/")) return null;
  const snap = await col.doc(itemId).get();
  return snap.exists ? (snap.data() as OpenFinanceItem) : null;
}

export async function findItemsByUser(userId: string): Promise<OpenFinanceItem[]> {
  const snap = await col.where("userId", "==", userId).get();
  return snap.docs.map((doc) => doc.data() as OpenFinanceItem).sort((a, b) => a.createdAt - b.createdAt);
}

export async function markSynced(itemId: string, accountId: string, until: string): Promise<void> {
  await col.doc(itemId).set({ syncedUntil: { [accountId]: until } }, { merge: true });
}

export async function deleteItem(itemId: string): Promise<void> {
  await col.doc(itemId).delete();
}

export async function savePending(itemId: string, pending: NonNullable<OpenFinanceItem["pending"]>): Promise<void> {
  await col.doc(itemId).set({ pending }, { merge: true });
}
