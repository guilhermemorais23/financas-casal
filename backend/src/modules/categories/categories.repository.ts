import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export interface CategoryRow {
  id: string;
  groupId: string | null;
  name: string;
  emoji: string | null;
  isDefault: boolean;
}

const categoriesCol = db.collection("categories");

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\//g, "-");
}

function categoryDocId(groupId: string | null, name: string): string {
  return `${groupId ?? "global"}__${normalize(name)}`;
}

function toCategoryRow(doc: FirebaseFirestore.DocumentSnapshot): CategoryRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId ?? null,
    name: data.name,
    emoji: data.emoji ?? null,
    isDefault: data.isDefault ?? false,
  };
}

export async function findVisibleCategories(groupId: string | null): Promise<CategoryRow[]> {
  const queries = [categoriesCol.where("groupId", "==", null).get()];
  if (groupId) {
    queries.push(categoriesCol.where("groupId", "==", groupId).get());
  }
  const snapshots = await Promise.all(queries);
  const rows = snapshots.flatMap((snapshot) => snapshot.docs.map(toCategoryRow));
  return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export class DuplicateCategoryError extends Error {}

export async function insertCategory(input: {
  groupId: string;
  name: string;
  emoji: string | null;
}): Promise<CategoryRow> {
  const id = categoryDocId(input.groupId, input.name);
  try {
    await categoriesCol.doc(id).create({
      groupId: input.groupId,
      name: input.name,
      emoji: input.emoji,
      isDefault: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 6 /* ALREADY_EXISTS */) {
      throw new DuplicateCategoryError();
    }
    throw err;
  }
  return { id, groupId: input.groupId, name: input.name, emoji: input.emoji, isDefault: false };
}

export async function categoryIsVisibleTo(categoryId: string, groupId: string): Promise<boolean> {
  const doc = await categoriesCol.doc(categoryId).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  return data.groupId === null || data.groupId === groupId;
}

export async function findCategoryById(categoryId: string): Promise<CategoryRow | null> {
  const doc = await categoriesCol.doc(categoryId).get();
  if (!doc.exists) return null;
  return toCategoryRow(doc);
}

// Renaming keeps the doc's existing id (derived from the *original* name at
// create time) rather than migrating to a freshly-derived one -- every
// transaction/budget referencing this category by id keeps pointing at the
// right doc. The only cost is the id no longer matches the current name,
// which is invisible to callers (nothing re-derives an id from a name
// except insertCategory's own create-time dedupe check).
export async function updateCategory(
  categoryId: string,
  fields: { name?: string; emoji?: string | null }
): Promise<CategoryRow> {
  const update: Record<string, unknown> = {};
  if (fields.name !== undefined) update.name = fields.name;
  if (fields.emoji !== undefined) update.emoji = fields.emoji;
  await categoriesCol.doc(categoryId).update(update);
  const doc = await categoriesCol.doc(categoryId).get();
  return toCategoryRow(doc);
}

// Transactions/budgets that reference this category by id simply degrade to
// "Sem categoria" afterward (every read site already falls back on a
// missing category lookup) -- no cascade needed.
export async function deleteCategory(categoryId: string): Promise<void> {
  await categoriesCol.doc(categoryId).delete();
}
