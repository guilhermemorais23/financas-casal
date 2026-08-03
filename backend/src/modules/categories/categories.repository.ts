import { query } from "../../db/pool";

export interface CategoryRow {
  id: string;
  couple_id: string | null;
  name: string;
  emoji: string | null;
  is_default: boolean;
}

export async function findVisibleCategories(coupleId: string | null): Promise<CategoryRow[]> {
  const result = await query<CategoryRow>(
    "SELECT * FROM categories WHERE couple_id IS NULL OR couple_id = $1 ORDER BY is_default DESC, name",
    [coupleId]
  );
  return result.rows;
}

export async function categoryIsVisibleTo(categoryId: string, coupleId: string): Promise<boolean> {
  const result = await query(
    "SELECT 1 FROM categories WHERE id = $1 AND (couple_id IS NULL OR couple_id = $2)",
    [categoryId, coupleId]
  );
  return result.rows.length > 0;
}

export class DuplicateCategoryError extends Error {}

export async function insertCategory(input: {
  coupleId: string;
  name: string;
  emoji: string | null;
}): Promise<CategoryRow> {
  try {
    const result = await query<CategoryRow>(
      `INSERT INTO categories (couple_id, name, emoji, is_default)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [input.coupleId, input.name, input.emoji]
    );
    return result.rows[0];
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "23505") {
      throw new DuplicateCategoryError();
    }
    throw err;
  }
}
