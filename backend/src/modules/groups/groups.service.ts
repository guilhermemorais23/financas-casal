import { randomBytes } from "crypto";
import { findUserById, type UserRow } from "../users/users.repository";
import { requestedGroupId } from "../../utils/activeGroup";
import { getAccountBalances } from "../transactions/transactions.repository";
import {
  createAccount,
  createGroup,
  findAccountsByGroupId,
  findGroupById,
  findMembersByGroupId,
  addUserToGroup,
  removeUserFromGroup,
  updateGroupFinancialProfile,
  updateGroupIdentity,
  type AccountRow,
  type GroupRow,
  type MemberRow,
} from "./groups.repository";
import {
  createInvite,
  findInviteByToken,
  findPendingInviteByGroupId,
  markInviteAccepted,
} from "./invites.repository";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Casal, família, república... cinco dá e sobra, e segura o custo de leitura.
export const MAX_GROUPS_PER_USER = 5;

export class AlreadyInGroupError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteNotPendingError extends Error {}
export class InviteExpiredError extends Error {}
export class NoGroupError extends Error {}
export class MemberNotFoundError extends Error {}
export class CannotRemoveSelfError extends Error {}
export class TooManyGroupsError extends Error {}
// O app pediu (X-Group-Id) um grupo do qual a pessoa não é membro.
export class GroupAccessError extends Error {}

function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

// O grupo aberto nesta requisição: o que o app pediu (X-Group-Id), se a
// pessoa for membro dele; sem pedido, o último grupo em que ela entrou.
// Tudo que é de um grupo (transações, metas, cartões...) passa por aqui, então
// é este o ponto que impede alguém de ver um grupo que não é dele.
export function resolveActiveGroupId(user: Pick<UserRow, "groupId" | "groupIds">): string | null {
  const requested = requestedGroupId();
  if (requested) {
    if (!user.groupIds.includes(requested)) throw new GroupAccessError();
    return requested;
  }
  return user.groupId;
}

export async function findActiveGroupId(userId: string): Promise<string | null> {
  const user = await findUserById(userId);
  return user ? resolveActiveGroupId(user) : null;
}

export async function requireGroupId(userId: string): Promise<string> {
  const groupId = await findActiveGroupId(userId);
  if (!groupId) {
    throw new NoGroupError();
  }
  return groupId;
}

function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 40);
  return trimmed || null;
}

function cleanEmoji(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && [...trimmed].length <= 8 ? trimmed : null;
}

export async function createGroupForUser(userId: string, input: { name?: unknown; emoji?: unknown } = {}) {
  const user = await findUserById(userId);
  if (!user) throw new NoGroupError();
  if (user.groupIds.length >= MAX_GROUPS_PER_USER) throw new TooManyGroupsError();

  const group = await createGroup({ nickname: cleanNickname(input.name), emoji: cleanEmoji(input.emoji) });
  await addUserToGroup(user, group.id);
  await createAccount({
    groupId: group.id,
    ownerUserId: userId,
    type: "personal",
    name: `Conta de ${user.displayName}`,
  });
  await createAccount({
    groupId: group.id,
    ownerUserId: null,
    type: "joint",
    name: "Nossa Conta",
    emoji: "🏠",
  });

  const invite = await createInvite({
    groupId: group.id,
    inviterId: userId,
    token: generateInviteToken(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  return { group, inviteToken: invite.token };
}

export async function acceptInvite(userId: string, token: string) {
  const user = await findUserById(userId);
  if (!user) throw new NoGroupError();

  const invite = await findInviteByToken(token);
  if (!invite) throw new InviteNotFoundError();
  if (invite.status !== "pending") throw new InviteNotPendingError();
  if (invite.expiresAt.getTime() < Date.now()) throw new InviteExpiredError();
  if (user.groupIds.includes(invite.groupId)) throw new AlreadyInGroupError();
  if (user.groupIds.length >= MAX_GROUPS_PER_USER) throw new TooManyGroupsError();

  await addUserToGroup(user, invite.groupId);
  await createAccount({
    groupId: invite.groupId,
    ownerUserId: userId,
    type: "personal",
    name: `Conta de ${user.displayName}`,
  });
  await markInviteAccepted(invite.token, userId);

  const group = await findGroupById(invite.groupId);
  return { group };
}

export async function createNewInvite(userId: string): Promise<string> {
  const groupId = await requireGroupId(userId);
  const invite = await createInvite({
    groupId,
    inviterId: userId,
    token: generateInviteToken(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return invite.token;
}

// "Desvincular conta": no data reconciliation, just detach -- the group's
// data is untouched and stays fully accessible to whoever remains in it.
// Só sai do grupo aberto; os outros grupos da pessoa continuam como estão.
export async function leaveGroup(userId: string): Promise<void> {
  const user = await findUserById(userId);
  const groupId = user ? resolveActiveGroupId(user) : null;
  if (!user || !groupId) throw new NoGroupError();
  await removeUserFromGroup(user, groupId);
}

// Any member can remove any other -- same mutual-trust model already used
// for managing joint accounts/transactions, there's no owner/admin role on
// a group. Removing yourself is what leaveGroup is for instead, so it's
// rejected here rather than silently doing the same thing under a
// different name.
export async function removeMemberForUser(userId: string, targetUserId: string): Promise<void> {
  const groupId = await requireGroupId(userId);
  if (targetUserId === userId) {
    throw new CannotRemoveSelfError();
  }
  const members = await findMembersByGroupId(groupId);
  const target = members.some((member) => member.id === targetUserId) ? await findUserById(targetUserId) : null;
  if (!target) {
    throw new MemberNotFoundError();
  }
  await removeUserFromGroup(target, groupId);
}

export async function getGroupForUser(userId: string): Promise<{
  group: GroupRow;
  accounts: (AccountRow & { balance: number })[];
  members: MemberRow[];
  pendingInviteToken: string | null;
} | null> {
  const groupId = await findActiveGroupId(userId);
  if (!groupId) return null;

  const group = await findGroupById(groupId);
  if (!group) return null;

  const [accounts, members, pendingInvite, balanceRows] = await Promise.all([
    findAccountsByGroupId(group.id),
    findMembersByGroupId(group.id),
    findPendingInviteByGroupId(group.id),
    getAccountBalances(group.id),
  ]);
  const pendingInviteToken =
    pendingInvite && pendingInvite.inviterId === userId ? pendingInvite.token : null;

  const balanceByAccountId = new Map(balanceRows.map((row) => [row.accountId, row.balanceCents]));
  // Personal accounts are independent money: only the joint account and the
  // requester's own personal account come back, so a groupmate's personal
  // balance/name never reaches anyone else.
  const visibleAccounts = accounts
    .filter((account) => account.type === "joint" || account.ownerUserId === userId)
    .map((account) => ({
      ...account,
      balance: (balanceByAccountId.get(account.id) ?? 0) / 100,
    }));

  return { group, accounts: visibleAccounts, members, pendingInviteToken };
}

export async function updateFinancialProfile(
  userId: string,
  updates: { financialGoal?: string | null; savingsAmount?: number | null }
): Promise<GroupRow> {
  const groupId = await requireGroupId(userId);
  await updateGroupFinancialProfile(groupId, updates);
  const group = await findGroupById(groupId);
  return group!;
}

export interface GroupSummary {
  id: string;
  nickname: string | null;
  emoji: string | null;
  memberCount: number;
}

// Pro seletor de grupo: só o que a própria pessoa já pode ver (nome, emoji e
// quantas pessoas), nunca nada de dentro dos grupos.
export async function listGroupsForUser(userId: string): Promise<{ groups: GroupSummary[]; defaultGroupId: string | null }> {
  const user = await findUserById(userId);
  if (!user) return { groups: [], defaultGroupId: null };
  const rows = await Promise.all(
    user.groupIds.map(async (groupId) => {
      const [group, members] = await Promise.all([findGroupById(groupId), findMembersByGroupId(groupId)]);
      return group ? { id: group.id, nickname: group.nickname, emoji: group.emoji, memberCount: members.length } : null;
    })
  );
  return { groups: rows.filter((row): row is GroupSummary => row !== null), defaultGroupId: user.groupId };
}

export async function updateGroupIdentityForUser(
  userId: string,
  input: { name?: unknown; emoji?: unknown }
): Promise<GroupRow> {
  const groupId = await requireGroupId(userId);
  const updates: { nickname?: string | null; emoji?: string | null } = {};
  if (input.name !== undefined) updates.nickname = cleanNickname(input.name);
  if (input.emoji !== undefined) updates.emoji = cleanEmoji(input.emoji);
  await updateGroupIdentity(groupId, updates);
  return (await findGroupById(groupId))!;
}
