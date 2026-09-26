import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
import { findUserDocsInGroup, type UserRow } from "../users/users.repository";

export interface GroupRow {
  id: string;
  nickname: string | null;
  emoji: string | null;
  financialGoal: string | null;
  savingsAmount: number | null;
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

export async function createGroup(input: { nickname?: string | null; emoji?: string | null } = {}): Promise<GroupRow> {
  const nickname = input.nickname ?? null;
  const emoji = input.emoji ?? null;
  const ref = await groupsCol.add({
    nickname,
    emoji,
    financialGoal: null,
    savingsAmount: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id, nickname, emoji, financialGoal: null, savingsAmount: null };
}

export function findGroupById(groupId: string): Promise<GroupRow | null> {
  return memoizeScoped(`group:${groupId}`, [`group:${groupId}`, "groups"], () => loadFindGroupById(groupId));
}

async function loadFindGroupById(groupId: string): Promise<GroupRow | null> {
  const doc = await groupsCol.doc(groupId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    nickname: data.nickname ?? null,
    emoji: data.emoji ?? null,
    financialGoal: data.financialGoal ?? null,
    savingsAmount: data.savingsAmount ?? null,
  };
}

export async function updateGroupFinancialProfile(
  groupId: string,
  updates: { financialGoal?: string | null; savingsAmount?: number | null }
): Promise<void> {
  await groupsCol.doc(groupId).set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function updateGroupIdentity(
  groupId: string,
  updates: { nickname?: string | null; emoji?: string | null }
): Promise<void> {
  await groupsCol.doc(groupId).set({ ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Entrar num grupo não tira a pessoa dos outros; o novo vira o aberto por
// padrão (groupId). A lista inteira é regravada (e não arrayUnion) pra levar
// junto o groupId de perfis de antes dos vários grupos, que não têm groupIds.
export async function addUserToGroup(user: Pick<UserRow, "id" | "groupIds">, groupId: string): Promise<void> {
  const groupIds = user.groupIds.includes(groupId) ? user.groupIds : [...user.groupIds, groupId];
  await usersCol.doc(user.id).set({ groupIds, groupId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function removeUserFromGroup(
  user: Pick<UserRow, "id" | "groupId" | "groupIds">,
  groupId: string
): Promise<void> {
  const groupIds = user.groupIds.filter((id) => id !== groupId);
  const primary = user.groupId && user.groupId !== groupId ? user.groupId : groupIds[0] ?? null;
  await usersCol.doc(user.id).set({ groupIds, groupId: primary, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
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

export function findAccountsByGroupId(groupId: string): Promise<AccountRow[]> {
  return memoizeScoped(`accounts:${groupId}`, [`group:${groupId}`, "groups"], () => loadFindAccountsByGroupId(groupId));
}

async function loadFindAccountsByGroupId(groupId: string): Promise<AccountRow[]> {
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

export function findMembersByGroupId(groupId: string): Promise<MemberRow[]> {
  return memoizeScoped(`members:${groupId}`, [`group:${groupId}`, "groups"], () => loadFindMembersByGroupId(groupId));
}

async function loadFindMembersByGroupId(groupId: string): Promise<MemberRow[]> {
  const docs = await findUserDocsInGroup(groupId);
  return docs.map((doc) => ({ id: doc.id, displayName: doc.data().displayName }));
}
