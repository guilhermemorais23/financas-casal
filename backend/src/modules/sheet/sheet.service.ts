// ============================================================================
// PLANILHA DO ANO (função opcional "Planilha")
// ============================================================================
// Pra quem controlava tudo numa planilha: os meses lado a lado, categoria
// abrindo em subcategoria (Casa › Hipoteca, Água, Luz), receitas e quanto
// sobrou. Não é um dado novo -- é o mesmo extrato somado de outro jeito.
//
// - getSheet: os totais de cada categoria em cada mês, mais as marcações.
// - listSheetEntries: o que tem dentro de um valor (ou de uma marcação).
// - importSheet: traz a planilha antiga (cada célula vira um lançamento no
//   dia 1 daquele mês) e cria as categorias/subcategorias que faltarem.
// - undoSheetImport: apaga tudo que uma importação criou.
// ============================================================================
import { randomUUID } from "node:crypto";
import { findVisibleCategories, insertCategory, DuplicateCategoryError, type CategoryRow } from "../categories/categories.repository";
import { findUsableAccount } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  deleteTransactionsBatch,
  findSheetDocs,
  findSheetImportIds,
  insertTransactionsBatch,
  type NewTransactionInput,
} from "../transactions/transactions.repository";
import { fromCents, toCents } from "../../utils/money";

export class InvalidSheetInputError extends Error {}
export class SheetAccountError extends Error {}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
export const MAX_IMPORT_ROWS = 400;

export function parseYear(value: unknown): number {
  const year = Number(value);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) throw new InvalidSheetInputError("Ano inválido.");
  return year;
}

export interface SheetRow {
  // null = sem categoria.
  categoryId: string | null;
  transactionType: "expense" | "income";
  // Jan..Dez, em reais ("0.00" no mês sem nada).
  months: string[];
  total: string;
}

export interface SheetTag {
  tag: string;
  count: number;
  total: string;
}

export interface Sheet {
  year: number;
  categories: CategoryRow[];
  rows: SheetRow[];
  tags: SheetTag[];
}

export async function getSheet(userId: string, year: number): Promise<Sheet> {
  const groupId = await requireGroupId(userId);
  const [docs, categories] = await Promise.all([
    findSheetDocs(groupId, userId, `${year}-01-01`, `${year + 1}-01-01`),
    findVisibleCategories(groupId),
  ]);
  const cells = new Map<string, { categoryId: string | null; transactionType: "expense" | "income"; cents: number[] }>();
  const tags = new Map<string, { count: number; cents: number }>();
  for (const doc of docs) {
    const month = Number(doc.date.slice(5, 7)) - 1;
    const type = doc.transactionType === "income" ? "income" : "expense";
    const key = `${type}:${doc.categoryId ?? "none"}`;
    const cell = cells.get(key) ?? { categoryId: doc.categoryId, transactionType: type, cents: Array(12).fill(0) };
    cell.cents[month] += doc.amountCents;
    cells.set(key, cell);
    for (const tag of doc.tags) {
      const entry = tags.get(tag) ?? { count: 0, cents: 0 };
      entry.count++;
      // A marcação soma o que saiu (receita com marcação conta na lista, não no total).
      if (type === "expense") entry.cents += doc.amountCents;
      tags.set(tag, entry);
    }
  }
  return {
    year,
    categories,
    rows: [...cells.values()].map((cell) => ({
      categoryId: cell.categoryId,
      transactionType: cell.transactionType,
      months: cell.cents.map(fromCents),
      total: fromCents(cell.cents.reduce((sum, cents) => sum + cents, 0)),
    })),
    tags: [...tags.entries()]
      .map(([tag, entry]) => ({ tag, count: entry.count, total: fromCents(entry.cents) }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "pt-BR")),
  };
}

export interface SheetEntry {
  id: string;
  date: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  categoryId: string | null;
  tags: string[];
}

// O que tem dentro de um valor da planilha (categoria + mês) ou de uma
// marcação no ano. categoryId "none" = sem categoria.
export async function listSheetEntries(
  userId: string,
  filter: { year: number; month?: number; categoryId?: string; tag?: string }
): Promise<SheetEntry[]> {
  const groupId = await requireGroupId(userId);
  const from = filter.month ? `${filter.year}-${String(filter.month).padStart(2, "0")}-01` : `${filter.year}-01-01`;
  const to = filter.month
    ? filter.month === 12
      ? `${filter.year + 1}-01-01`
      : `${filter.year}-${String(filter.month + 1).padStart(2, "0")}-01`
    : `${filter.year + 1}-01-01`;
  const docs = await findSheetDocs(groupId, userId, from, to);
  return docs
    .filter((doc) => filter.categoryId === undefined || (doc.categoryId ?? "none") === filter.categoryId)
    .filter((doc) => filter.tag === undefined || doc.tags.includes(filter.tag))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 300)
    .map((doc) => ({
      id: doc.id,
      date: doc.date,
      description: doc.description,
      amount: fromCents(doc.amountCents),
      transactionType: doc.transactionType === "income" ? "income" : "expense",
      categoryId: doc.categoryId,
      tags: doc.tags,
    }));
}

// ---- importar a planilha antiga -------------------------------------------

export interface SheetImportRow {
  // Categoria de cima ("Casa"); null quando a linha já é a categoria.
  group: string | null;
  // Nome da linha ("Hipoteca").
  name: string;
  transactionType: "expense" | "income";
  // Jan..Dez; null ou 0 = nada naquele mês.
  months: (number | null)[];
}

export function parseImportBody(body: unknown): { year: number; accountId: string; rows: SheetImportRow[] } {
  const input = (body ?? {}) as Record<string, unknown>;
  const year = parseYear(input.year);
  if (typeof input.accountId !== "string" || !input.accountId) throw new InvalidSheetInputError("Escolha a conta.");
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new InvalidSheetInputError("Nenhuma linha pra importar.");
  if (input.rows.length > MAX_IMPORT_ROWS) throw new InvalidSheetInputError(`No máximo ${MAX_IMPORT_ROWS} linhas por vez.`);
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;
  const rows = input.rows.map((raw, index): SheetImportRow => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const name = text(row.name, 60);
    const group = row.group === null || row.group === undefined ? null : text(row.group, 60);
    if (!name || (row.group !== null && row.group !== undefined && !group)) {
      throw new InvalidSheetInputError(`Linha ${index + 1}: nome vazio ou longo demais.`);
    }
    if (row.transactionType !== "expense" && row.transactionType !== "income") {
      throw new InvalidSheetInputError(`Linha ${index + 1}: diga se é gasto ou receita.`);
    }
    if (!Array.isArray(row.months) || row.months.length !== 12) {
      throw new InvalidSheetInputError(`Linha ${index + 1}: precisa dos 12 meses.`);
    }
    const months = row.months.map((value) => {
      if (value === null || value === undefined || value === 0) return null;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
        throw new InvalidSheetInputError(`Linha ${index + 1}: valor inválido.`);
      }
      return value;
    });
    return { group, name, transactionType: row.transactionType, months };
  });
  return { year, accountId: input.accountId, rows };
}

const plain = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

export async function importSheet(
  userId: string,
  input: { year: number; accountId: string; rows: SheetImportRow[] }
): Promise<{ importId: string; created: number; categoriesCreated: number }> {
  const groupId = await requireGroupId(userId);
  const account = await findUsableAccount(groupId, userId, input.accountId);
  if (!account) throw new SheetAccountError();

  // Acha (ou cria) a categoria pelo nome, sem ligar pra acento e maiúscula.
  const categories = [...(await findVisibleCategories(groupId))];
  let categoriesCreated = 0;
  async function ensure(name: string, type: "expense" | "income", parent: CategoryRow | null): Promise<CategoryRow> {
    const found = categories.find(
      (category) => plain(category.name) === plain(name) && category.type === type && (category.parentId ?? null) === (parent?.id ?? null)
    );
    if (found) return found;
    try {
      const created = await insertCategory({ groupId, name, emoji: null, type, parentId: parent?.id ?? null });
      categories.push(created);
      categoriesCreated++;
      return created;
    } catch (err) {
      if (!(err instanceof DuplicateCategoryError)) throw err;
      // Mesmo nome com outro tipo/lugar: usa a que já existe com esse nome.
      const same = (await findVisibleCategories(groupId)).find((category) => plain(category.name) === plain(name));
      if (!same) throw err;
      return same;
    }
  }

  const importId = randomUUID();
  const transactions: NewTransactionInput[] = [];
  for (const row of input.rows) {
    const parent = row.group ? await ensure(row.group, row.transactionType, null) : null;
    const category = await ensure(row.name, row.transactionType, parent);
    row.months.forEach((value, month) => {
      if (!value || toCents(value) <= 0) return;
      transactions.push({
        groupId,
        accountId: account.id,
        accountType: account.type,
        accountOwnerId: account.ownerUserId,
        categoryId: category.id,
        payerId: userId,
        createdBy: userId,
        description: row.name,
        amount: value,
        transactionType: row.transactionType,
        occurredAt: `${input.year}-${String(month + 1).padStart(2, "0")}-01`,
        isPrivate: false,
        splitType: "none",
        tags: ["planilha"],
        sheetImportId: importId,
      });
    });
  }
  const created = await insertTransactionsBatch(transactions);
  return { importId, created, categoriesCreated };
}

export async function undoSheetImport(userId: string, importId: string): Promise<number> {
  const groupId = await requireGroupId(userId);
  const ids = await findSheetImportIds(groupId, importId);
  await deleteTransactionsBatch(ids);
  return ids.length;
}
