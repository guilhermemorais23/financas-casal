import { query } from "../../db/pool";

export interface CoupleRow {
  id: string;
  nickname: string | null;
  emoji: string | null;
}

export interface AccountRow {
  id: string;
  couple_id: string;
  owner_user_id: string | null;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
}

export async function createCouple(): Promise<CoupleRow> {
  const result = await query<CoupleRow>(
    "INSERT INTO couples DEFAULT VALUES RETURNING id, nickname, emoji"
  );
  return result.rows[0];
}

export async function findCoupleById(coupleId: string): Promise<CoupleRow | null> {
  const result = await query<CoupleRow>(
    "SELECT id, nickname, emoji FROM couples WHERE id = $1",
    [coupleId]
  );
  return result.rows[0] ?? null;
}

export async function setUserCouple(userId: string, coupleId: string): Promise<void> {
  await query("UPDATE users SET couple_id = $2, updated_at = now() WHERE id = $1", [
    userId,
    coupleId,
  ]);
}

export async function countMembers(coupleId: string): Promise<number> {
  const result = await query<{ count: string }>(
    "SELECT COUNT(*) FROM users WHERE couple_id = $1",
    [coupleId]
  );
  return Number(result.rows[0].count);
}

export async function createAccount(input: {
  coupleId: string;
  ownerUserId: string | null;
  type: "personal" | "joint";
  name: string;
  emoji?: string | null;
}): Promise<AccountRow> {
  const result = await query<AccountRow>(
    `INSERT INTO accounts (couple_id, owner_user_id, type, name, emoji)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, couple_id, owner_user_id, type, name, emoji`,
    [input.coupleId, input.ownerUserId, input.type, input.name, input.emoji ?? null]
  );
  return result.rows[0];
}

export async function findAccountsByCoupleId(coupleId: string): Promise<AccountRow[]> {
  const result = await query<AccountRow>(
    "SELECT id, couple_id, owner_user_id, type, name, emoji FROM accounts WHERE couple_id = $1",
    [coupleId]
  );
  return result.rows;
}

export interface MemberRow {
  id: string;
  display_name: string;
}

export async function findMembersByCoupleId(coupleId: string): Promise<MemberRow[]> {
  const result = await query<MemberRow>(
    "SELECT id, display_name FROM users WHERE couple_id = $1",
    [coupleId]
  );
  return result.rows;
}
