import { query } from "../../db/pool";

export interface InviteRow {
  id: string;
  couple_id: string;
  inviter_id: string;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  accepted_by: string | null;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

export async function createInvite(input: {
  coupleId: string;
  inviterId: string;
  token: string;
  expiresAt: Date;
}): Promise<InviteRow> {
  const result = await query<InviteRow>(
    `INSERT INTO couple_invites (couple_id, inviter_id, token, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.coupleId, input.inviterId, input.token, input.expiresAt]
  );
  return result.rows[0];
}

export async function findInviteByToken(token: string): Promise<InviteRow | null> {
  const result = await query<InviteRow>("SELECT * FROM couple_invites WHERE token = $1", [token]);
  return result.rows[0] ?? null;
}

export async function findPendingInviteByCoupleId(coupleId: string): Promise<InviteRow | null> {
  const result = await query<InviteRow>(
    "SELECT * FROM couple_invites WHERE couple_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
    [coupleId]
  );
  return result.rows[0] ?? null;
}

export async function markInviteAccepted(inviteId: string, acceptedByUserId: string): Promise<void> {
  await query(
    "UPDATE couple_invites SET status = 'accepted', accepted_by = $2, accepted_at = now() WHERE id = $1",
    [inviteId, acceptedByUserId]
  );
}
