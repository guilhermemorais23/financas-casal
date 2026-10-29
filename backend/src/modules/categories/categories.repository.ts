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

// Pra onde vai o que usava uma categoria apagada: despesa cai em "Outros"
// (mesmo id e emoji do script de seed), entrada cai em "Receita".
const DEFAULT_OTHER = { id: "global__outros", name: "Outros", emoji: "✨" };
export const OTHER_CATEGORY_ID = DEFAULT_OTHER.id;
export const INCOME_CATEGORY_ID = DEFAULT_INCOME.id;

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

// As padrão são criadas por script (seed). "Receita" veio depois, e "Outros"
// passou a ser o destino do que usava uma categoria apagada -- então as duas
// são criadas aqui na primeira leitura se ainda não existirem.
async function ensureDefaultCategory(
  rows: CategoryRow[],
  base: { id: string; name: string; emoji: string },
  type: CategoryType
): Promise<CategoryRow[]> {
  if (rows.some((row) => row.id === base.id)) return rows;
  const created: CategoryRow = { ...base, groupId: null, isDefault: true, type };
  try {
    await categoriesCol.doc(base.id).create({
      groupId: null,
      name: created.name,
      emoji: created.emoji,
      isDefault: true,
      type,
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
  const found = snapshots.flatMap((snapshot) => snapshot.docs.map(toCategoryRow));
  const withIncome = await ensureDefaultCategory(found, DEFAULT_INCOME, "income");
  const rows = await ensureDefaultCategory(withIncome, DEFAULT_OTHER, "expense");
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

// Renomear mantém o id do documento (calculado a partir do nome *original*
// na criação) em vez de trocar por um id novo -- todo lançamento e orçamento
// que aponta pra esta categoria pelo id continua apontando pro documento
// certo. O único custo é o id não bater mais com o nome atual, o que ninguém
// vê (nada recalcula id a partir de nome, a não ser a checagem de duplicado
// do próprio insertCategory na criação).
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

// Pra qual categoria vai o que apontava pra uma que não existe mais:
// entrada vai pra "Receita", despesa vai pra "Outros".
export function replacementCategoryId(type: CategoryType): string {
  return type === "income" ? INCOME_CATEGORY_ID : OTHER_CATEGORY_ID;
}

// Onde mais o id da categoria fica guardado. Ao excluir, tudo isso passa pra
// "Outros" (ou "Receita", se a categoria era de receita), que é o que a tela
// de excluir avisa. Só esconder o nome não basta: Relatórios agrupa pelo id.
// O orçamento por categoria não entra: a tela só lista categorias que existem.
const COLLECTIONS_MOVED_TO_REPLACEMENT = ["transactions", "recurringBills", "debts"];

// Grava em lotes de até 400 (o limite do Firestore é 500 por lote).
async function setCategoryIn(docs: FirebaseFirestore.QueryDocumentSnapshot[], categoryId: string | null): Promise<void> {
  for (let start = 0; start < docs.length; start += 400) {
    const batch = db.batch();
    for (const doc of docs.slice(start, start + 400)) {
      batch.update(doc.ref, { categoryId });
    }
    await batch.commit();
  }
}

// O id de categoria de grupo começa pelo id do grupo (categoryDocId), então
// buscar só por categoryId já fica dentro do grupo. As compras de cartão são
// subcoleção de cada cartão: percorre os cartões do grupo em vez de usar
// collectionGroup (o projeto evita, ver transactions.repository.ts).
// As regras de importação ficam VAZIAS (não viram "Outros"): senão toda
// importação futura daquele nome cairia em Outros sem a pessoa escolher.
export async function deleteCategory(category: { id: string; groupId: string; type: CategoryType }): Promise<void> {
  const replacement = replacementCategoryId(category.type);
  for (const name of COLLECTIONS_MOVED_TO_REPLACEMENT) {
    const snapshot = await db.collection(name).where("categoryId", "==", category.id).get();
    await setCategoryIn(snapshot.docs, replacement);
  }
  const cards = await db.collection("cards").where("groupId", "==", category.groupId).get();
  for (const card of cards.docs) {
    const purchases = await card.ref.collection("purchases").where("categoryId", "==", category.id).get();
    await setCategoryIn(purchases.docs, replacement);
  }
  const rules = await db.collection("importRules").where("categoryId", "==", category.id).get();
  await setCategoryIn(rules.docs, null);
  await categoriesCol.doc(category.id).delete();
}
