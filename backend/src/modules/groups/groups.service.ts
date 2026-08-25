import { randomBytes } from "crypto";
import { findUserById } from "../users/users.repository";
import { getAccountBalances } from "../transactions/transactions.repository";
import {
  createAccount,
  createGroup,
  findAccountsByGroupId,
  findGroupById,
  findMembersByGroupId,
  setUserGroup,
  updateGroupFinancialProfile,
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

export class AlreadyInGroupError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteNotPendingError extends Error {}
export class InviteExpiredError extends Error {}
export class NoGroupError extends Error {}

function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function requireGroupId(userId: string): Promise<string> {
  const user = await findUserById(userId);
  if (!user?.groupId) {
    throw new NoGroupError();
  }
  return user.groupId;
}

export async function createGroupForUser(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new NoGroupError();
  if (user.groupId) throw new AlreadyInGroupError();

  const group = await createGroup();
  await setUserGroup(userId, group.id);
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
  if (user.groupId) throw new AlreadyInGroupError();

  const invite = await findInviteByToken(token);
  if (!invite) throw new InviteNotFoundError();
  if (invite.status !== "pending") throw new InviteNotPendingError();
  if (invite.expiresAt.getTime() < Date.now()) throw new InviteExpiredError();

  await setUserGroup(userId, invite.groupId);
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
export async function leaveGroup(userId: string): Promise<void> {
  await requireGroupId(userId);
  await setUserGroup(userId, null);
}

export async function getGroupForUser(userId: string): Promise<{
  group: GroupRow;
  accounts: (AccountRow & { balance: number })[];
  members: MemberRow[];
  pendingInviteToken: string | null;
} | null> {
  const user = await findUserById(userId);
  if (!user?.groupId) return null;

  const group = await findGroupById(user.groupId);
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
