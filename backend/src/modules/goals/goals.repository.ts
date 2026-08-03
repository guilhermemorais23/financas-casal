import { query } from "../../db/pool";

export interface GoalRow {
  id: string;
  couple_id: string;
  name: string;
  emoji: string | null;
  target_amount: string;
  current_amount: string;
  deadline: string | null;
  achieved_at: string | null;
  created_at: string;
}

export async function insertGoal(input: {
  coupleId: string;
  name: string;
  emoji: string | null;
  targetAmount: number;
  deadline: string | null;
}): Promise<GoalRow> {
  const result = await query<GoalRow>(
    `INSERT INTO goals (couple_id, name, emoji, target_amount, deadline)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [input.coupleId, input.name, input.emoji, input.targetAmount, input.deadline]
  );
  return result.rows[0];
}

export async function findGoalsByCoupleId(coupleId: string): Promise<GoalRow[]> {
  const result = await query<GoalRow>(
    "SELECT * FROM goals WHERE couple_id = $1 ORDER BY achieved_at IS NOT NULL, created_at DESC",
    [coupleId]
  );
  return result.rows;
}

export async function findGoalById(goalId: string): Promise<GoalRow | null> {
  const result = await query<GoalRow>("SELECT * FROM goals WHERE id = $1", [goalId]);
  return result.rows[0] ?? null;
}

export async function addToGoalAmount(
  goalId: string,
  amount: number
): Promise<GoalRow> {
  const result = await query<GoalRow>(
    `UPDATE goals
     SET current_amount = current_amount + $2,
         achieved_at = CASE
           WHEN achieved_at IS NULL AND current_amount + $2 >= target_amount THEN now()
           ELSE achieved_at
         END,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [goalId, amount]
  );
  return result.rows[0];
}

export async function deleteGoal(goalId: string): Promise<void> {
  await query("DELETE FROM goals WHERE id = $1", [goalId]);
}
