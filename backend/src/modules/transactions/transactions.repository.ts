import { query } from "../../db/pool";

export type SplitType = "none" | "equal" | "proportional" | "by_category" | "custom";

export interface TransactionRow {
  id: string;
  couple_id: string;
  account_id: string;
  category_id: string | null;
  payer_id: string;
  created_by: string;
  description: string;
  amount: string;
  transaction_type: "expense" | "income";
  occurred_at: string;
  is_private: boolean;
  split_type: SplitType;
  created_at: string;
}

export interface TransactionListRow extends TransactionRow {
  category_name: string | null;
  category_emoji: string | null;
}

export interface BalanceRow {
  couple_id: string;
  paid_by: string;
  owed_by: string;
  total_owed: string;
}

export async function insertTransaction(input: {
  coupleId: string;
  accountId: string;
  categoryId: string | null;
  payerId: string;
  createdBy: string;
  description: string;
  amount: number;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
}): Promise<TransactionRow> {
  const result = await query<TransactionRow>(
    `INSERT INTO transactions
       (couple_id, account_id, category_id, payer_id, created_by, description, amount, occurred_at, is_private, split_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.coupleId,
      input.accountId,
      input.categoryId,
      input.payerId,
      input.createdBy,
      input.description,
      input.amount,
      input.occurredAt,
      input.isPrivate,
      input.splitType,
    ]
  );
  return result.rows[0];
}

export async function insertSplits(
  transactionId: string,
  splits: { userId: string; shareAmount: number }[]
): Promise<void> {
  for (const split of splits) {
    await query(
      "INSERT INTO transaction_splits (transaction_id, user_id, share_amount) VALUES ($1, $2, $3)",
      [transactionId, split.userId, split.shareAmount]
    );
  }
}

export async function findTransactionsVisibleTo(
  coupleId: string,
  requestingUserId: string,
  limit: number
): Promise<TransactionListRow[]> {
  const result = await query<TransactionListRow>(
    `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.couple_id = $1 AND (t.is_private = false OR t.created_by = $2)
     ORDER BY t.occurred_at DESC, t.created_at DESC
     LIMIT $3`,
    [coupleId, requestingUserId, limit]
  );
  return result.rows;
}

export async function getBalanceRows(coupleId: string): Promise<BalanceRow[]> {
  const result = await query<BalanceRow>("SELECT * FROM couple_balances WHERE couple_id = $1", [
    coupleId,
  ]);
  return result.rows;
}
