import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";

// Despesa ou receita: a tela de lançar mostra só as do tipo do lançamento.
// Categoria antiga (de antes do campo) é de despesa.
export type CategoryType = "expense" | "income";

export interface CategoryRow {
  id: string;
  groupId: string | null;
  name: string;
  emoji: string | null;
  isDefault: boolean;
  type: CategoryType;
}

// A categoria de receita que todo grupo tem (e não dá pra apagar). Quem tem
// outras fontes (salário, aluguel recebido, freela) cria as suas.
const DEFAULT_INCOME = { id: "global__receita", name: "Receita", emoji: "💰" };

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
    type: data.type === "income" ? "income" : "expense",
  };
}

// As padrão são criadas por script (seed); a de receita veio depois, então é
// criada aqui na primeira leitura se ainda não existir.
async function ensureDefaultIncomeCategory(rows: CategoryRow[]): Promise<CategoryRow[]> {
  if (rows.some((row) => row.id === DEFAULT_INCOME.id)) return rows;
  const created: CategoryRow = { ...DEFAULT_INCOME, groupId: null, isDefault: true, type: "income" };
  try {
    await categoriesCol.doc(DEFAULT_INCOME.id).create({
      groupId: null,
      name: created.name,
      emoji: created.emoji,
      isDefault: true,
      type: "income",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Outra requisição criou primeiro: tudo bem.
    if (!(err && typeof err === "object" && "code" in err && err.code === 6)) throw err;
  }
  return [...rows, created];
}

export function findVisibleCategories(groupId: string | null): Promise<CategoryRow[]> {
  return memoizeScoped(`categories:${groupId}`, [`group:${groupId}`, "categories"], () => loadFindVisibleCategories(groupId));
}

async function loadFindVisibleCategories(groupId: string | null): Promise<CategoryRow[]> {
  const queries = [categoriesCol.where("groupId", "==", null).get()];
  if (groupId) {
    queries.push(categoriesCol.where("groupId", "==", groupId).get());
  }
  const snapshots = await Promise.all(queries);
  const rows = await ensureDefaultIncomeCategory(snapshots.flatMap((snapshot) => snapshot.docs.map(toCategoryRow)));
  return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

export class DuplicateCategoryError extends Error {}

export async function insertCategory(input: {
  groupId: string;
  name: string;
  emoji: string | null;
  type?: CategoryType;
}): Promise<CategoryRow> {
  const type = input.type ?? "expense";
  const id = categoryDocId(input.groupId, input.name);
  try {
    await categoriesCol.doc(id).create({
      groupId: input.groupId,
      name: input.name,
      emoji: input.emoji,
      isDefault: false,
      type,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === 6 /* ALREADY_EXISTS */) {
      throw new DuplicateCategoryError();
    }
    throw err;
  }
  return { id, groupId: input.groupId, name: input.name, emoji: input.emoji, isDefault: false, type };
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
