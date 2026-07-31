import { randomBytes } from "crypto";
import { findUserById } from "../auth/users.repository";
import {
  countMembers,
  createAccount,
  createCouple,
  findAccountsByCoupleId,
  findCoupleById,
  findMembersByCoupleId,
  setUserCouple,
  type AccountRow,
  type CoupleRow,
  type MemberRow,
} from "./couples.repository";
import {
  createInvite,
  findInviteByToken,
  findPendingInviteByCoupleId,
  markInviteAccepted,
} from "./invites.repository";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COUPLE_MEMBERS = 2;

export class AlreadyInCoupleError extends Error {}
export class InviteNotFoundError extends Error {}
export class InviteNotPendingError extends Error {}
export class InviteExpiredError extends Error {}
export class CoupleFullError extends Error {}
export class NoCoupleError extends Error {}

function generateInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function requireCoupleId(userId: string): Promise<string> {
  const user = await findUserById(userId);
  if (!user?.couple_id) {
    throw new NoCoupleError();
  }
  return user.couple_id;
}

export async function createCoupleForUser(userId: string) {
  const user = await findUserById(userId);
  if (!user) {
    throw new NoCoupleError();
  }
  if (user.couple_id) {
    throw new AlreadyInCoupleError();
  }

  const couple = await createCouple();
  await setUserCouple(userId, couple.id);
  await createAccount({
    coupleId: couple.id,
    ownerUserId: userId,
    type: "personal",
    name: `Conta de ${user.display_name}`,
  });
  await createAccount({
    coupleId: couple.id,
    ownerUserId: null,
    type: "joint",
    name: "Nossa Conta",
    emoji: "🏠",
  });

  const invite = await createInvite({
    coupleId: couple.id,
    inviterId: userId,
    token: generateInviteToken(),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  return { couple, inviteToken: invite.token };
}

export async function acceptInvite(userId: string, token: string) {
  const user = await findUserById(userId);
  if (!user) {
    throw new NoCoupleError();
  }
  if (user.couple_id) {
    throw new AlreadyInCoupleError();
  }

  const invite = await findInviteByToken(token);
  if (!invite) {
    throw new InviteNotFoundError();
  }
  if (invite.status !== "pending") {
    throw new InviteNotPendingError();
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw new InviteExpiredError();
  }

  const memberCount = await countMembers(invite.couple_id);
  if (memberCount >= MAX_COUPLE_MEMBERS) {
    throw new CoupleFullError();
  }

  await setUserCouple(userId, invite.couple_id);
  await createAccount({
    coupleId: invite.couple_id,
    ownerUserId: userId,
    type: "personal",
    name: `Conta de ${user.display_name}`,
  });
  await markInviteAccepted(invite.id, userId);

  const couple = await findCoupleById(invite.couple_id);
  return { couple };
}

export async function getCoupleForUser(userId: string): Promise<{
  couple: CoupleRow;
  accounts: AccountRow[];
  members: MemberRow[];
  pendingInviteToken: string | null;
} | null> {
  const user = await findUserById(userId);
  if (!user?.couple_id) {
    return null;
  }

  const couple = await findCoupleById(user.couple_id);
  if (!couple) {
    return null;
  }

  const accounts = await findAccountsByCoupleId(couple.id);
  const members = await findMembersByCoupleId(couple.id);
  const pendingInvite = await findPendingInviteByCoupleId(couple.id);
  const pendingInviteToken =
    pendingInvite && pendingInvite.inviter_id === userId ? pendingInvite.token : null;

  return { couple, accounts, members, pendingInviteToken };
}
