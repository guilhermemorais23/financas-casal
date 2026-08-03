import { query } from "../../db/pool";

export type SplitType = "none" | "equal" | "proportional" | "by_category" | "custom";
export type TransactionType = "expense" | "income";

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
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
}): Promise<TransactionRow> {
  const result = await query<TransactionRow>(
    `INSERT INTO transactions
       (couple_id, account_id, category_id, payer_id, created_by, description, amount, transaction_type, occurred_at, is_private, split_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.coupleId,
      input.accountId,
      input.categoryId,
      input.payerId,
      input.createdBy,
      input.description,
      input.amount,
      input.transactionType,
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
  limit: number,
  range?: { monthStart: string; monthEnd: string },
  accountId?: string
): Promise<TransactionListRow[]> {
  const params: unknown[] = [coupleId, requestingUserId, limit];
  let filters = "";
  if (range) {
    params.push(range.monthStart, range.monthEnd);
    filters += ` AND t.occurred_at >= $${params.length - 1} AND t.occurred_at < $${params.length}`;
  }
  if (accountId) {
    params.push(accountId);
    filters += ` AND t.account_id = $${params.length}`;
  }

  const result = await query<TransactionListRow>(
    `SELECT t.*, c.name AS category_name, c.emoji AS category_emoji
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.couple_id = $1
       AND (t.is_private = false OR t.created_by = $2)
       AND (a.type = 'joint' OR a.owner_user_id = $2)
       ${filters}
     ORDER BY t.occurred_at DESC, t.created_at DESC
     LIMIT $3`,
    params
  );
  return result.rows;
}

export async function getBalanceRows(coupleId: string): Promise<BalanceRow[]> {
  const result = await query<BalanceRow>("SELECT * FROM couple_balances WHERE couple_id = $1", [
    coupleId,
  ]);
  return result.rows;
}

export async function findTransactionById(transactionId: string): Promise<TransactionRow | null> {
  const result = await query<TransactionRow>("SELECT * FROM transactions WHERE id = $1", [
    transactionId,
  ]);
  return result.rows[0] ?? null;
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  await query("DELETE FROM transactions WHERE id = $1", [transactionId]);
}

export async function updateTransaction(
  transactionId: string,
  fields: {
    description?: string;
    amount?: number;
    transactionType?: TransactionType;
    categoryId?: string | null;
    occurredAt?: string;
  }
): Promise<TransactionRow> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (fields.description !== undefined) set("description", fields.description);
  if (fields.amount !== undefined) set("amount", fields.amount);
  if (fields.transactionType !== undefined) set("transaction_type", fields.transactionType);
  if (fields.categoryId !== undefined) set("category_id", fields.categoryId);
  if (fields.occurredAt !== undefined) set("occurred_at", fields.occurredAt);
  sets.push("updated_at = now()");

  params.push(transactionId);
  const result = await query<TransactionRow>(
    `UPDATE transactions SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows[0];
}

export async function deleteSplitsForTransaction(transactionId: string): Promise<void> {
  await query("DELETE FROM transaction_splits WHERE transaction_id = $1", [transactionId]);
}

export interface AccountBalanceRow {
  account_id: string;
  balance: string;
}

// Net of income minus expense per account. Accounts have no stored running
// balance (see schema); this is derived from the transaction log each time.
export async function getAccountBalances(coupleId: string): Promise<AccountBalanceRow[]> {
  const result = await query<AccountBalanceRow>(
    `SELECT account_id,
            SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE -amount END) AS balance
     FROM transactions
     WHERE couple_id = $1
     GROUP BY account_id`,
    [coupleId]
  );
  return result.rows;
}

export interface CategorySummaryRow {
  category_id: string | null;
  category_name: string | null;
  category_emoji: string | null;
  total: string;
}

export interface PayerSummaryRow {
  payer_id: string;
  total: string;
}

// Scoped to the joint account only: the couple's shared budget/summary tracks
// what leaves "Nossa Conta", not either partner's independent personal spending
// (which the other partner can't see at all -- see findTransactionsVisibleTo).
export async function getMonthlySummary(
  coupleId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string
): Promise<{ byCategory: CategorySummaryRow[]; byPayer: PayerSummaryRow[]; total: string }> {
  const visibility = "(t.is_private = false OR t.created_by = $2)";

  const byCategory = await query<CategorySummaryRow>(
    `SELECT t.category_id, c.name AS category_name, c.emoji AS category_emoji, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id AND a.type = 'joint'
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.couple_id = $1 AND t.transaction_type = 'expense'
       AND t.occurred_at >= $3 AND t.occurred_at < $4 AND ${visibility}
     GROUP BY t.category_id, c.name, c.emoji
     ORDER BY total DESC`,
    [coupleId, requestingUserId, monthStart, monthEnd]
  );

  const byPayer = await query<PayerSummaryRow>(
    `SELECT t.payer_id, SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id AND a.type = 'joint'
     WHERE t.couple_id = $1 AND t.transaction_type = 'expense'
       AND t.occurred_at >= $2 AND t.occurred_at < $3
     GROUP BY t.payer_id`,
    [coupleId, monthStart, monthEnd]
  );

  const total = byPayer.rows.reduce((sum, row) => sum + Number(row.total), 0);

  return { byCategory: byCategory.rows, byPayer: byPayer.rows, total: total.toFixed(2) };
}
