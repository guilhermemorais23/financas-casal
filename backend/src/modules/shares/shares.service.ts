import { randomBytes } from "node:crypto";
import { fromCents, toCents } from "../../utils/money";
import { isValidMonthParam, InvalidMonthError } from "../../utils/month";
import { requireGroupId } from "../groups/groups.service";
import { findUserById } from "../users/users.repository";
import { listTransactions } from "../transactions/transactions.service";
import type { TransactionListRow } from "../transactions/transactions.repository";
import {
  findShareByToken,
  insertShare,
  markShareRevoked,
  type ShareCategoryTotal,
  type ShareRow,
  type ShareSnapshot,
} from "./shares.repository";

export class ShareNotFoundError extends Error {}

export const SHARE_TTL_DAYS = 7;
// Same order of magnitude as the CSV export cap: far above one month.
const MAX_SHARE_ROWS = 2000;

// What a link is allowed to show: the joint account plus the requester's
// own personal account. Never anything flagged private, and never a
// groupmate's personal spending, even when that is not private in the app.
export function isShareable(row: TransactionListRow, userId: string): boolean {
  if (row.isPrivate) return false;
  return row.accountType === "joint" || row.accountOwnerId === userId;
}

export function buildShareSnapshot(
  rows: TransactionListRow[],
  userId: string,
  month: string,
  ownerName: string
): ShareSnapshot {
  const shareable = rows.filter((row) => isShareable(row, userId));

  let incomeCents = 0;
  let expenseCents = 0;
  const categoryCents = new Map<string, { name: string | null; emoji: string | null; cents: number }>();

  for (const row of shareable) {
    const cents = toCents(Number(row.amount));
    if (row.transactionType === "income") {
      incomeCents += cents;
      continue;
    }
    expenseCents += cents;
    const key = row.categoryId ?? "none";
    const entry = categoryCents.get(key) ?? { name: row.categoryName, emoji: row.categoryEmoji, cents: 0 };
    entry.cents += cents;
    categoryCents.set(key, entry);
  }

  const byCategory: ShareCategoryTotal[] = Array.from(categoryCents.values())
    .sort((a, b) => b.cents - a.cents)
    .map((entry) => ({ categoryName: entry.name, categoryEmoji: entry.emoji, total: fromCents(entry.cents) }));

  return {
    month,
    ownerName,
    totalIncome: fromCents(incomeCents),
    totalExpense: fromCents(expenseCents),
    byCategory,
    transactions: shareable
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .map((row) => ({
        description: row.description,
        amount: row.amount,
        transactionType: row.transactionType,
        occurredAt: row.occurredAt,
        categoryName: row.categoryName,
        categoryEmoji: row.categoryEmoji,
        paymentMethod: row.paymentMethod,
      })),
  };
}

export async function createShare(userId: string, monthParam: unknown) {
  if (!isValidMonthParam(monthParam)) throw new InvalidMonthError();
  await requireGroupId(userId);
  const [rows, user] = await Promise.all([
    listTransactions(userId, MAX_SHARE_ROWS, monthParam),
    findUserById(userId),
  ]);
  const snapshot = buildShareSnapshot(rows, userId, monthParam, user?.displayName ?? "Alguém");
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86_400_000);
  const share = await insertShare(token, { ...snapshot, ownerId: userId, expiresAt });
  return { id: share.id, expiresAt: share.expiresAt };
}

function isActive(share: ShareRow): boolean {
  return share.revokedAt === null && new Date(share.expiresAt).getTime() > Date.now();
}

// Missing, expired and revoked all look the same from outside on purpose.
export async function getPublicShare(token: string) {
  const share = await findShareByToken(token);
  if (!share || !isActive(share)) throw new ShareNotFoundError();
  const { ownerId: _ownerId, revokedAt: _revokedAt, ...publicFields } = share;
  return publicFields;
}

export async function revokeShare(userId: string, token: string) {
  const share = await findShareByToken(token);
  if (!share || share.ownerId !== userId) throw new ShareNotFoundError();
  await markShareRevoked(token);
}
