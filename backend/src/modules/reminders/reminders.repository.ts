import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

const reminderLogsCol = db.collection("reminderLogs");
const usersCol = db.collection("users");
const groupsCol = db.collection("groups");

export interface MemberWithEmail {
  id: string;
  displayName: string;
  email: string | null;
}

export interface GroupIdRow {
  id: string;
}

export async function findAllGroupIds(): Promise<GroupIdRow[]> {
  // Only the id is needed to drive the per-group loop below -- select()
  // avoids pulling every group's full profile doc for nothing.
  const snapshot = await groupsCol.select().get();
  return snapshot.docs.map((doc) => ({ id: doc.id }));
}

// Unlike groups.repository's findMembersByGroupId, the reminders job needs
// an address to actually send to.
export async function findMembersWithEmailByGroupId(groupId: string): Promise<MemberWithEmail[]> {
  const snapshot = await usersCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, displayName: data.displayName, email: data.email ?? null };
  });
}

// Has this exact reminder (one card's statement, one group's monthly budget
// overrun...) already gone out? Keyed deterministically by the caller so the
// same event never emails twice even if the cron fires more than once.
export async function wasReminderSent(key: string): Promise<boolean> {
  const doc = await reminderLogsCol.doc(key).get();
  return doc.exists;
}

export async function markReminderSent(key: string, meta: Record<string, unknown>): Promise<void> {
  await reminderLogsCol.doc(key).set({ ...meta, sentAt: FieldValue.serverTimestamp() });
}
