import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export type FeedbackKind = "idea" | "problem" | "praise";
export type MessageFrom = "user" | "team" | "auto";

export interface FeedbackMessage {
  id: string;
  from: MessageFrom;
  text: string;
  kind: FeedbackKind | null;
  authorName: string | null;
  page: string | null;
  createdAt: number;
}

export interface FeedbackThread {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  lastMessage: string;
  lastFrom: MessageFrom;
  lastKind: FeedbackKind | null;
  lastMessageAt: number;
  unreadForUser: number;
  unreadForTeam: number;
}

// One ongoing conversation per person (thread id = their user id), like a
// support chat: everything they send and every answer lives in it.
const threadsCol = db.collection("feedbackThreads");

function toThread(doc: FirebaseFirestore.DocumentSnapshot): FeedbackThread {
  const data = doc.data()!;
  return {
    id: doc.id,
    userId: data.userId,
    email: data.email,
    displayName: data.displayName,
    lastMessage: data.lastMessage ?? "",
    lastFrom: data.lastFrom ?? "user",
    lastKind: data.lastKind ?? null,
    lastMessageAt: data.lastMessageAt ?? 0,
    unreadForUser: data.unreadForUser ?? 0,
    unreadForTeam: data.unreadForTeam ?? 0,
  };
}

function toMessage(doc: FirebaseFirestore.QueryDocumentSnapshot): FeedbackMessage {
  const data = doc.data();
  return {
    id: doc.id,
    from: data.from,
    text: data.text,
    kind: data.kind ?? null,
    authorName: data.authorName ?? null,
    page: data.page ?? null,
    createdAt: data.createdAt,
  };
}

export async function findThread(threadId: string): Promise<FeedbackThread | null> {
  const doc = await threadsCol.doc(threadId).get();
  return doc.exists ? toThread(doc) : null;
}

export async function listThreads(limit = 100): Promise<FeedbackThread[]> {
  const snapshot = await threadsCol.orderBy("lastMessageAt", "desc").limit(limit).get();
  return snapshot.docs.map(toThread);
}

export async function listMessages(threadId: string): Promise<FeedbackMessage[]> {
  const snapshot = await threadsCol.doc(threadId).collection("messages").orderBy("createdAt", "asc").limit(500).get();
  return snapshot.docs.map(toMessage);
}

export async function addMessage(
  thread: { id: string; userId: string; email: string; displayName: string },
  message: Omit<FeedbackMessage, "id">
): Promise<void> {
  const ref = threadsCol.doc(thread.id);
  const batch = db.batch();
  batch.set(ref.collection("messages").doc(), message);
  batch.set(
    ref,
    {
      userId: thread.userId,
      email: thread.email,
      displayName: thread.displayName,
      lastMessage: message.text.slice(0, 200),
      lastFrom: message.from,
      ...(message.kind ? { lastKind: message.kind } : {}),
      lastMessageAt: message.createdAt,
      ...(message.from === "user" ? { unreadForTeam: FieldValue.increment(1) } : {}),
      ...(message.from === "team" || message.from === "auto" ? { unreadForUser: FieldValue.increment(1) } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await batch.commit();
}

export async function markRead(threadId: string, side: "user" | "team"): Promise<void> {
  const ref = threadsCol.doc(threadId);
  const doc = await ref.get();
  if (!doc.exists) return;
  await ref.update(side === "user" ? { unreadForUser: 0 } : { unreadForTeam: 0 });
}
