import { query } from "../../db/pool";

export interface BudgetRow {
  id: string;
  couple_id: string;
  period_month: string;
  cap_amount: string;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

// Whole-couple budget for a month (category_id IS NULL). The schema's
// UNIQUE(couple_id, period_month, category_id) doesn't dedupe NULLs in
// Postgres, so upserts for the whole-couple row are done as find-then-
// update/insert in application code rather than ON CONFLICT.
export async function findCoupleBudget(
  coupleId: string,
  periodMonth: string
): Promise<BudgetRow | null> {
  const result = await query<BudgetRow>(
    `SELECT * FROM budgets WHERE couple_id = $1 AND period_month = $2 AND category_id IS NULL`,
    [coupleId, periodMonth]
  );
  return result.rows[0] ?? null;
}

export async function insertCoupleBudget(input: {
  coupleId: string;
  periodMonth: string;
  capAmount: number;
}): Promise<BudgetRow> {
  const result = await query<BudgetRow>(
    `INSERT INTO budgets (couple_id, period_month, cap_amount, category_id)
     VALUES ($1, $2, $3, NULL)
     RETURNING *`,
    [input.coupleId, input.periodMonth, input.capAmount]
  );
  return result.rows[0];
}

export async function updateBudgetCap(budgetId: string, capAmount: number): Promise<BudgetRow> {
  const result = await query<BudgetRow>(
    `UPDATE budgets SET cap_amount = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [budgetId, capAmount]
  );
  return result.rows[0];
}

// Scoped to the joint account: the couple's budget tracks "Nossa Conta"
// spending, not either partner's independent personal spending.
export async function getMonthlyExpenseTotal(
  coupleId: string,
  monthStart: string,
  monthEnd: string
): Promise<number> {
  const result = await query<{ total: string | null }>(
    `SELECT SUM(t.amount) AS total
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id AND a.type = 'joint'
     WHERE t.couple_id = $1 AND t.transaction_type = 'expense'
       AND t.occurred_at >= $2 AND t.occurred_at < $3`,
    [coupleId, monthStart, monthEnd]
  );
  return Number(result.rows[0]?.total ?? 0);
}
