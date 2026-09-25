import { fromCents } from "../../utils/money";
import { BANKS, parsePdfStatement, type Bank } from "../../utils/pdfStatement";
import { StatementParseError, cleanStatementDescription, parseDate, parseStatement, type ParsedStatementRow } from "../../utils/statementParser";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { deleteRule, findRulesByGroup, normalizeStatementName, upsertRules } from "./importRules.repository";
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
  // "Pix enviado", "Compra no débito"... (null quando o extrato não separa).
  kind: string | null;
  // Nome normalizado: os lançamentos com o mesmo nome viram uma pergunta só.
  groupKey: string;
}

// Uma pergunta da importação: todos os lançamentos (novos) com o mesmo nome e
// o mesmo sentido. Vem do maior valor pro menor -- responder as primeiras já
// cobre quase todo o dinheiro.
export interface PreviewGroup {
  key: string;
  name: string;
  transactionType: "expense" | "income";
  kind: string | null;
  count: number;
  total: string;
  rowIndexes: number[];
  // Resposta guardada de uma importação anterior (null = pergunta nova).
  rule: { categoryId: string | null; notExpense: boolean } | null;
}

export interface PdfCheck {
  reconciled: boolean | null;
  difference: string;
  openingBalance: string | null;
  closingBalance: string | null;
  readBy: "ai" | "text";
  unreadLines: string[];
  bank: Bank | null;
}

export interface StatementInput {
  content?: unknown;
  pdfBase64?: unknown;
  password?: unknown;
  // Banco escolhido na tela (o leitor dele é tentado primeiro).
  bank?: unknown;
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

async function readInput(input: StatementInput): Promise<{ format: "ofx" | "csv" | "pdf"; rows: ParsedStatementRow[]; pdf: PdfCheck | null }> {
  if (typeof input.pdfBase64 === "string" && input.pdfBase64) {
    const data = new Uint8Array(Buffer.from(input.pdfBase64, "base64"));
    const chosen = BANKS.includes(input.bank as Bank) ? (input.bank as Bank) : null;
    const read = await parsePdfStatement(data, typeof input.password === "string" ? input.password : undefined, chosen);
    return {
      format: "pdf",
      rows: read.rows,
      pdf: {
        reconciled: read.reconciled,
        difference: fromCents(Math.abs(read.differenceCents)),
        openingBalance: read.openingBalanceCents === null ? null : (read.openingBalanceCents / 100).toFixed(2),
        closingBalance: read.closingBalanceCents === null ? null : (read.closingBalanceCents / 100).toFixed(2),
        readBy: read.readBy,
        unreadLines: read.unreadLines,
        bank: read.bank,
      },
    };
  }
  const text = input.content;
  if (typeof text !== "string" || text.trim() === "") {
    throw new StatementParseError("O arquivo está vazio.");
  }
  if (text.length > MAX_STATEMENT_CHARS) {
    throw new StatementParseError("Esse arquivo é grande demais. Exporte um período menor.");
  }
  const { format, rows } = parseStatement(text);
  return { format, rows, pdf: null };
}

// Turns what the file says into what the person will review: sign becomes
// a type, rows that already exist are flagged (same day, same amount, same
// direction), rows with the same name are grouped into one question, and
// names answered before (rules) or descriptions used before come with their
// category.
export async function previewStatement(userId: string, input: StatementInput) {
  const groupId = await requireGroupId(userId);
  const { format, rows, pdf } = await readInput(input);

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
  const rules = new Map((await findRulesByGroup(groupId)).map((rule) => [rule.key, rule]));

  const preview: PreviewRow[] = rows.map((row) => {
    const transactionType = assumedAllExpenses || row.amountCents < 0 ? "expense" : "income";
    const cents = Math.abs(row.amountCents);
    const cleaned = cleanStatementDescription(row.description);
    const groupKey = normalizeStatementName(cleaned);
    const rule = rules.get(groupKey);
    // O nome guardado na resposta (a pessoa pode ter digitado o nome inteiro
    // que o banco corta) vale pras próximas importações.
    const renamed = rule?.label?.trim() && normalizeStatementName(rule.label) !== rule.key;
    const description = renamed ? rule!.label.trim() : cleaned;
    return {
      date: row.date,
      description,
      kind: row.kind ?? null,
      amount: fromCents(cents),
      transactionType,
      suggestedCategoryId: rule ? rule.categoryId : (categoryHints.get(normalizeDescription(description)) ?? null),
      isDuplicate: existingKeys.has(duplicateKey(row.date, cents, transactionType)),
      groupKey,
    };
  });

  // Uma pergunta por nome (e sentido). O que já está no app não pergunta.
  const byKey = new Map<string, { group: PreviewGroup; cents: number }>();
  preview.forEach((row, index) => {
    if (row.isDuplicate) return;
    const id = `${row.transactionType}:${row.groupKey}`;
    let entry = byKey.get(id);
    if (!entry) {
      const rule = rules.get(row.groupKey);
      entry = {
        cents: 0,
        group: {
          key: row.groupKey,
          name: row.description,
          transactionType: row.transactionType,
          kind: row.kind,
          count: 0,
          total: "0.00",
          rowIndexes: [],
          rule: rule ? { categoryId: rule.categoryId, notExpense: rule.notExpense } : null,
        },
      };
      byKey.set(id, entry);
    }
    entry.cents += Math.round(Number(row.amount) * 100);
    entry.group.count += 1;
    entry.group.rowIndexes.push(index);
  });
  const groups = [...byKey.values()]
    .map(({ group, cents }) => ({ ...group, total: fromCents(cents), cents }))
    .sort((a, b) => b.cents - a.cents)
    .map(({ cents: _cents, ...group }) => group);

  return { format, assumedAllExpenses, rows: preview, groups, pdf };
}

export interface ImportItem {
  description: string;
  amount: number;
  transactionType: "expense" | "income";
  occurredAt: string;
  categoryId: string | null;
}

export interface RuleInput {
  key: string;
  label: string;
  categoryId: string | null;
  notExpense: boolean;
}

export async function commitStatement(userId: string, accountId: string, items: ImportItem[], rules: RuleInput[] = []) {
  // Sem lançamento nenhum só vale quando tudo foi "Não é gasto": aí só as
  // respostas são guardadas.
  if (items.length > MAX_IMPORT_ITEMS || (items.length === 0 && rules.length === 0)) throw new InvalidImportItemError();
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

  // As respostas viram regras pra próxima importação (só com categoria que o
  // grupo enxerga; "Não é gasto" vale sem categoria).
  const groupId = await requireGroupId(userId);
  const validRules: RuleInput[] = [];
  for (const rule of rules.slice(0, 300)) {
    if (typeof rule.key !== "string" || !rule.key.trim()) continue;
    const categoryId = rule.notExpense ? null : typeof rule.categoryId === "string" && rule.categoryId ? rule.categoryId : null;
    if (!rule.notExpense && !categoryId) continue;
    if (categoryId && !(await categoryIsVisibleTo(categoryId, groupId))) continue;
    validRules.push({
      key: normalizeStatementName(rule.key),
      label: typeof rule.label === "string" && rule.label.trim() ? rule.label.trim().slice(0, 120) : rule.key,
      categoryId,
      notExpense: rule.notExpense === true,
    });
  }
  await upsertRules(groupId, userId, validRules);
  return { created, rulesSaved: validRules.length };
}

// ---- regras guardadas (Conta e grupo) -----------------------------------

export class InvalidRuleError extends Error {}

export async function listImportRules(userId: string) {
  const groupId = await requireGroupId(userId);
  return findRulesByGroup(groupId);
}

export async function saveImportRule(userId: string, input: { key?: unknown; label?: unknown; categoryId?: unknown; notExpense?: unknown }) {
  const groupId = await requireGroupId(userId);
  if (typeof input.key !== "string" || !input.key.trim()) throw new InvalidRuleError();
  const notExpense = input.notExpense === true;
  const categoryId = notExpense ? null : typeof input.categoryId === "string" && input.categoryId ? input.categoryId : null;
  if (!notExpense && !categoryId) throw new InvalidRuleError();
  if (categoryId && !(await categoryIsVisibleTo(categoryId, groupId))) throw new InvalidRuleError();
  const key = normalizeStatementName(input.key);
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 120) : key;
  await upsertRules(groupId, userId, [{ key, label, categoryId, notExpense }]);
  return { key, label, categoryId, notExpense };
}

export async function removeImportRule(userId: string, key: string) {
  const groupId = await requireGroupId(userId);
  await deleteRule(groupId, normalizeStatementName(key));
}
