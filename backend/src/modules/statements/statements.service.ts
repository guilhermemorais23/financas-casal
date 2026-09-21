import { fromCents } from "../../utils/money";
import { StatementParseError, parseDate, parseStatement } from "../../utils/statementParser";
import { requireGroupId } from "../groups/groups.service";
import { createTransaction } from "../transactions/transactions.service";
import { findTransactionsVisibleTo, type TransactionListRow } from "../transactions/transactions.repository";

export { StatementParseError };
export class InvalidImportItemError extends Error {}

export const MAX_STATEMENT_CHARS = 900_000;
export const MAX_IMPORT_ITEMS = 500;
// How far back existing transactions are compared for duplicates and
// category hints. A statement covers weeks, not years.
const COMPARE_LIMIT = 1500;

export interface PreviewRow {
  date: string;
  description: string;
  amount: string; // positive decimal
  transactionType: "expense" | "income";
  suggestedCategoryId: string | null;
  isDuplicate: boolean;
}

function normalizeDescription(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const duplicateKey = (date: string, cents: number, type: string) => `${date}|${cents}|${type}`;

// Turns what the file says into what the person will review: sign becomes
// a type, rows that already exist are flagged (same day, same amount, same
// direction) and known descriptions get the category they had last time.
export async function previewStatement(userId: string, text: unknown) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new StatementParseError("O arquivo está vazio.");
  }
  if (text.length > MAX_STATEMENT_CHARS) {
    throw new StatementParseError("Esse arquivo é grande demais. Exporte um período menor.");
  }
  const groupId = await requireGroupId(userId);
  const { format, rows } = parseStatement(text);

  // Some banks export purchases as positive numbers. With no negative row
  // at all there is no way to tell, so treat everything as an expense and
  // let the screen offer to flip it.
  const hasNegative = rows.some((row) => row.amountCents < 0);
  const assumedAllExpenses = !hasNegative;

  const existing: TransactionListRow[] = await findTransactionsVisibleTo(groupId, userId, COMPARE_LIMIT);
  const existingKeys = new Set(
    existing.map((tx) => duplicateKey(tx.occurredAt.slice(0, 10), Math.round(Number(tx.amount) * 100), tx.transactionType))
  );
  // findTransactionsVisibleTo returns newest first, so the first hit per
  // description is the most recent category used for it.
  const categoryHints = new Map<string, string>();
  for (const tx of existing) {
    if (!tx.categoryId) continue;
    const key = normalizeDescription(tx.description);
    if (!categoryHints.has(key)) categoryHints.set(key, tx.categoryId);
  }

  const preview: PreviewRow[] = rows.map((row) => {
    const transactionType = assumedAllExpenses || row.amountCents < 0 ? "expense" : "income";
    const cents = Math.abs(row.amountCents);
    return {
      date: row.date,
      description: row.description,
      amount: fromCents(cents),
      transactionType,
      suggestedCategoryId: categoryHints.get(normalizeDescription(row.description)) ?? null,
      isDuplicate: existingKeys.has(duplicateKey(row.date, cents, transactionType)),
    };
  });

  return { format, assumedAllExpenses, rows: preview };
}

export interface ImportItem {
  description: string;
  amount: number;
  transactionType: "expense" | "income";
  occurredAt: string;
  categoryId: string | null;
}

export async function commitStatement(userId: string, accountId: string, items: ImportItem[]) {
  if (items.length === 0 || items.length > MAX_IMPORT_ITEMS) throw new InvalidImportItemError();
  for (const item of items) {
    if (
      typeof item.description !== "string" ||
      item.description.trim() === "" ||
      typeof item.amount !== "number" ||
      !(item.amount > 0) ||
      (item.transactionType !== "expense" && item.transactionType !== "income") ||
      parseDate(item.occurredAt) !== item.occurredAt
    ) {
      throw new InvalidImportItemError();
    }
  }

  // One by one on purpose: createTransaction owns the account/category
  // validation and every side effect a normal save has.
  let created = 0;
  for (const item of items) {
    await createTransaction(userId, {
      accountId,
      categoryId: item.categoryId,
      payerId: userId,
      description: item.description.trim().slice(0, 120),
      amount: item.amount,
      transactionType: item.transactionType,
      occurredAt: item.occurredAt,
      isPrivate: false,
      splitType: "none",
      paymentMethod: null,
    });
    created++;
  }
  return { created };
}
