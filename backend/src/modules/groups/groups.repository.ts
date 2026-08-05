import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface GroupRow {
  id: string;
  nickname: string | null;
  emoji: string | null;
}

export interface MemberRow {
  id: string;
  displayName: string;
}

export interface AccountRow {
  id: string;
  groupId: string;
  ownerUserId: string | null;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
}

const groupsCol = db.collection("groups");
const usersCol = db.collection("users");
const accountsCol = db.collection("accounts");

export async function createGroup(): Promise<GroupRow> {
  const ref = await groupsCol.add({
    nickname: null,
    emoji: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, nickname: null, emoji: null };
}

export async function findGroupById(groupId: string): Promise<GroupRow | null> {
  const doc = await groupsCol.doc(groupId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { id: doc.id, nickname: data.nickname ?? null, emoji: data.emoji ?? null };
}

export async function setUserGroup(userId: string, groupId: string | null): Promise<void> {
  await usersCol.doc(userId).set({ groupId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function createAccount(input: {
  groupId: string;
  ownerUserId: string | null;
  type: "personal" | "joint";
  name: string;
  emoji?: string | null;
}): Promise<AccountRow> {
  const ref = await accountsCol.add({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    type: input.type,
    name: input.name,
    emoji: input.emoji ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    id: ref.id,
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    type: input.type,
    name: input.name,
    emoji: input.emoji ?? null,
  };
}

export async function findAccountsByGroupId(groupId: string): Promise<AccountRow[]> {
  const snapshot = await accountsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      groupId: data.groupId,
      ownerUserId: data.ownerUserId ?? null,
      type: data.type,
      name: data.name,
      emoji: data.emoji ?? null,
    };
  });
}

export async function findMembersByGroupId(groupId: string): Promise<MemberRow[]> {
  const snapshot = await usersCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, displayName: doc.data().displayName }));
}
