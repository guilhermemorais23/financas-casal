import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  groupId: string | null;
  photoDataUrl: string | null;
}

const usersCol = db.collection("users");

function toUserRow(id: string, data: FirebaseFirestore.DocumentData): UserRow {
  return {
    id,
    email: data.email,
    displayName: data.displayName,
    groupId: data.groupId ?? null,
    photoDataUrl: data.photoDataUrl ?? null,
  };
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) return null;
  return toUserRow(doc.id, doc.data()!);
}

// Idempotent: called on every sign-in, not just first-ever sign-up, so the
// profile doc always exists by the time any other endpoint needs it.
// isNew tells the caller whether this was the very first sign-in (e.g. to
// gate a welcome email so it doesn't fire on every login).
export async function upsertUserProfile(input: {
  id: string;
  email: string;
  displayName: string;
}): Promise<{ user: UserRow; isNew: boolean }> {
  const ref = usersCol.doc(input.id);
  const existing = await ref.get();
  if (existing.exists) {
    return { user: toUserRow(existing.id, existing.data()!), isNew: false };
  }

  await ref.set({
    email: input.email,
    displayName: input.displayName,
    groupId: null,
    photoDataUrl: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    user: { id: input.id, email: input.email, displayName: input.displayName, groupId: null, photoDataUrl: null },
    isNew: true,
  };
}

export async function updateUserProfile(
  userId: string,
  updates: { displayName?: string; photoDataUrl?: string | null }
): Promise<UserRow> {
  const ref = usersCol.doc(userId);
  await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  const doc = await ref.get();
  return toUserRow(doc.id, doc.data()!);
}
