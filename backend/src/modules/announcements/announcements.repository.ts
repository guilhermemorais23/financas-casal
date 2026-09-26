import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

// all = todo mundo que já tinha conta; couples/solo = grupo com 2+ pessoas ou
// sozinho; new = contas criadas nos 14 dias antes do envio ou depois (dica de
// começo); user = uma pessoa.
export type AnnouncementAudience = "all" | "couples" | "solo" | "new" | "user";

export interface Announcement {
  id: string;
  icon: string;
  tag: string;
  title: string;
  text: string;
  bullets: string[];
  ctaLabel: string | null;
  ctaPath: string | null;
  audience: AnnouncementAudience;
  // Só quando audience === "user": pra quem vai (e o nome, pra lista do admin).
  targetUserId: string | null;
  targetName: string | null;
  active: boolean;
  seenCount: number;
  // Quantos tocaram no botão do pop-up (uma vez por pessoa).
  clickCount: number;
  createdAt: number;
  createdBy: string;
}

export type NewAnnouncement = Omit<Announcement, "id" | "active" | "seenCount" | "clickCount" | "createdAt">;

// Um documento por comunicado; quem já viu fica em announcements/{id}/seen/{userId}.
const col = db.collection("announcements");

function toAnnouncement(doc: FirebaseFirestore.DocumentSnapshot): Announcement {
  const data = doc.data()!;
  return {
    id: doc.id,
    icon: data.icon ?? "spark",
    tag: data.tag ?? "Novidade",
    title: data.title,
    text: data.text,
    bullets: data.bullets ?? [],
    ctaLabel: data.ctaLabel ?? null,
    ctaPath: data.ctaPath ?? null,
    audience: data.audience,
    targetUserId: data.targetUserId ?? null,
    targetName: data.targetName ?? null,
    active: data.active ?? true,
    seenCount: data.seenCount ?? 0,
    clickCount: data.clickCount ?? 0,
    createdAt: data.createdAt,
    createdBy: data.createdBy,
  };
}

export async function insertAnnouncement(input: NewAnnouncement): Promise<Announcement> {
  const ref = col.doc();
  const data = { ...input, active: true, seenCount: 0, clickCount: 0, createdAt: Date.now() };
  await ref.set(data);
  return { id: ref.id, ...data };
}

export async function findAnnouncement(id: string): Promise<Announcement | null> {
  const doc = await col.doc(id).get();
  return doc.exists ? toAnnouncement(doc) : null;
}

export async function listAnnouncements(limit = 100): Promise<Announcement[]> {
  const snapshot = await col.orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map(toAnnouncement);
}

// Só filtro de igualdade (sem orderBy) pra não precisar de índice composto;
// são poucos comunicados ativos, a ordenação é feita em memória.
export async function listActiveAnnouncements(): Promise<Announcement[]> {
  const snapshot = await col.where("active", "==", true).limit(200).get();
  return snapshot.docs.map(toAnnouncement);
}

export async function setAnnouncementActive(id: string, active: boolean): Promise<void> {
  await col.doc(id).update({ active });
}

export async function findSeenIds(announcementIds: string[], userId: string): Promise<Set<string>> {
  if (announcementIds.length === 0) return new Set();
  const refs = announcementIds.map((id) => col.doc(id).collection("seen").doc(userId));
  const docs = await db.getAll(...refs);
  return new Set(docs.filter((doc) => doc.exists).map((doc) => doc.ref.parent.parent!.id));
}

// Idempotente: ver de novo (outra aba, outro aparelho) não conta duas vezes,
// nem o clique no botão.
export async function markSeen(id: string, userId: string, clicked = false): Promise<void> {
  const ref = col.doc(id);
  const seenRef = ref.collection("seen").doc(userId);
  await db.runTransaction(async (tx) => {
    const seen = await tx.get(seenRef);
    const wasClicked = seen.data()?.clicked === true;
    if (seen.exists && (wasClicked || !clicked)) return;
    const updates: Record<string, FirebaseFirestore.FieldValue> = {};
    if (!seen.exists) updates.seenCount = FieldValue.increment(1);
    if (clicked) updates.clickCount = FieldValue.increment(1);
    tx.set(seenRef, { at: seen.data()?.at ?? Date.now(), clicked: clicked || wasClicked });
    tx.update(ref, updates);
  });
}

export async function findUserCreatedAt(userId: string): Promise<number | null> {
  const doc = await db.collection("users").doc(userId).get();
  const createdAt = doc.data()?.createdAt as FirebaseFirestore.Timestamp | undefined;
  return createdAt ? createdAt.toMillis() : null;
}

export async function listPeople(limit = 500): Promise<{ id: string; displayName: string; email: string }[]> {
  const snapshot = await db.collection("users").select("displayName", "email").limit(limit).get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, displayName: doc.data().displayName ?? "", email: doc.data().email ?? "" }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pt-BR"));
}
