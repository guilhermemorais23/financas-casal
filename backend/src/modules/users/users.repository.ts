import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  groupId: string | null;
}

const usersCol = db.collection("users");

function toUserRow(id: string, data: FirebaseFirestore.DocumentData): UserRow {
  return {
    id,
    email: data.email,
    displayName: data.displayName,
    groupId: data.groupId ?? null,
  };
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) return null;
  return toUserRow(doc.id, doc.data()!);
}

// Idempotent: called on every sign-in, not just first-ever sign-up, so the
// profile doc always exists by the time any other endpoint needs it.
export async function upsertUserProfile(input: {
  id: string;
  email: string;
  displayName: string;
}): Promise<UserRow> {
  const ref = usersCol.doc(input.id);
  const existing = await ref.get();
  if (existing.exists) {
    return toUserRow(existing.id, existing.data()!);
  }

  await ref.set({
    email: input.email,
    displayName: input.displayName,
    groupId: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: input.id, email: input.email, displayName: input.displayName, groupId: null };
}
