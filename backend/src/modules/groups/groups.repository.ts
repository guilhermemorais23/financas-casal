import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
import { findUserDocsInGroup, groupIdsOf, type UserRow } from "../users/users.repository";

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
const invitesCol = db.collection("invites");

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
// padrão (groupId). A lista é relida dentro de uma transação do Firestore e
// regravada inteira (e não arrayUnion) pra levar junto o groupId de perfis de
// antes dos vários grupos, que não têm groupIds -- relida, pra que entrar em
// dois grupos ao mesmo tempo não perca um deles.
export async function addUserToGroup(user: Pick<UserRow, "id" | "groupIds">, groupId: string): Promise<void> {
  const ref = usersCol.doc(user.id);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const current = doc.exists ? groupIdsOf(doc.data()!) : user.groupIds;
    const groupIds = current.includes(groupId) ? current : [...current, groupId];
    t.set(ref, { groupIds, groupId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export async function removeUserFromGroup(
  user: Pick<UserRow, "id" | "groupId" | "groupIds">,
  groupId: string
): Promise<void> {
  const ref = usersCol.doc(user.id);
  await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    const data = doc.exists ? doc.data()! : { groupId: user.groupId, groupIds: user.groupIds };
    const groupIds = groupIdsOf(data).filter((id) => id !== groupId);
    const currentPrimary = typeof data.groupId === "string" ? data.groupId : null;
    const primary = currentPrimary && currentPrimary !== groupId ? currentPrimary : groupIds[0] ?? null;
    t.set(ref, { groupIds, groupId: primary, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}

export type JoinByInviteResult =
  | { ok: true; groupId: string }
  | { ok: false; reason: "not_found" | "not_pending" | "expired" | "already_member" | "too_many" };

// Aceitar convite numa transação só: confere o convite e o perfil, coloca a
// pessoa no grupo, marca o convite como usado e cria a conta pessoal dela.
// Dois cliques (ou duas pessoas com o mesmo link) não entram duas vezes nem
// criam duas contas. Quem volta pra um grupo de onde saiu recupera a conta
// pessoal que já tinha lá.
export async function joinGroupByInvite(
  userId: string,
  token: string,
  personalAccountName: string,
  maxGroups: number
): Promise<JoinByInviteResult> {
  const inviteRef = invitesCol.doc(token);
  const userRef = usersCol.doc(userId);
  return db.runTransaction(async (t): Promise<JoinByInviteResult> => {
    const [inviteDoc, userDoc] = await Promise.all([t.get(inviteRef), t.get(userRef)]);
    if (!inviteDoc.exists) return { ok: false, reason: "not_found" };
    const invite = inviteDoc.data()!;
    if (invite.status !== "pending") return { ok: false, reason: "not_pending" };
    if ((invite.expiresAt as FirebaseFirestore.Timestamp).toMillis() < Date.now()) return { ok: false, reason: "expired" };
    const groupId = invite.groupId as string;
    const groupIds = userDoc.exists ? groupIdsOf(userDoc.data()!) : [];
    if (groupIds.includes(groupId)) return { ok: false, reason: "already_member" };
    if (groupIds.length >= maxGroups) return { ok: false, reason: "too_many" };

    const existingAccount = await t.get(
      accountsCol.where("groupId", "==", groupId).where("ownerUserId", "==", userId).where("type", "==", "personal").limit(1)
    );

    t.set(userRef, { groupIds: [...groupIds, groupId], groupId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    t.update(inviteRef, { status: "accepted", acceptedBy: userId, acceptedAt: FieldValue.serverTimestamp() });
    if (existingAccount.empty) {
      t.set(accountsCol.doc(), {
        groupId,
        ownerUserId: userId,
        type: "personal",
        name: personalAccountName,
        emoji: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, groupId };
  });
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

// Conta em que a pessoa pode lançar: a conjunta do grupo ou a pessoal dela.
// A conta pessoal de outra pessoa do grupo nunca -- nem aparece pra ela no app.
export function isUsableAccount(account: Pick<AccountRow, "type" | "ownerUserId">, userId: string): boolean {
  return account.type === "joint" || account.ownerUserId === userId;
}

export async function findUsableAccount(groupId: string, userId: string, accountId: string): Promise<AccountRow | null> {
  const accounts = await findAccountsByGroupId(groupId);
  const account = accounts.find((a) => a.id === accountId);
  return account && isUsableAccount(account, userId) ? account : null;
}

// Por onde passa o dinheiro de algo que tem dono (cartão, dívida): a conta
// pessoal do dono, ou a conjunta quando é do grupo.
export async function findAccountForOwner(groupId: string, ownerUserId: string | null): Promise<AccountRow | null> {
  const accounts = await findAccountsByGroupId(groupId);
  return (
    (ownerUserId
      ? accounts.find((a) => a.type === "personal" && a.ownerUserId === ownerUserId)
      : accounts.find((a) => a.type === "joint")) ?? null
  );
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
