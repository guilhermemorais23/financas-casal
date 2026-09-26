import type { PaymentMethod } from "./paymentMethod";
import { groupSuffix } from "../api/activeGroup";

// Memória do lançamento rápido: pra cada descrição já usada, guarda a
// categoria, a conta e a forma de pagamento da última vez. Assim, digitar
// "Padaria" de novo já preenche "Alimentação" sozinho. Fica só neste
// aparelho (localStorage), por usuário; se o armazenamento falhar, o app só
// deixa de sugerir.

export interface RememberedEntry {
  description: string;
  categoryId: string | null;
  accountId: string | null;
  paymentMethod: PaymentMethod | null;
  usedAt: number;
}

const MAX_ENTRIES = 200;
// Contas e categorias são de um grupo: cada grupo lembra as suas.
const key = (userId: string) => `par:quick-entry:${userId}${groupSuffix()}`;

export function normalizeDescription(text: string): string {
  return text
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function readAll(userId: string): Record<string, RememberedEntry> {
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? "{}") as Record<string, RememberedEntry>;
  } catch {
    return {};
  }
}

export function rememberEntry(userId: string, entry: Omit<RememberedEntry, "usedAt">): void {
  const normalized = normalizeDescription(entry.description);
  if (!userId || !normalized) return;
  const all = readAll(userId);
  all[normalized] = { ...entry, description: entry.description.trim(), usedAt: Date.now() };
  // Mantém só as mais recentes, pra não crescer pra sempre.
  const trimmed = Object.entries(all)
    .sort(([, a], [, b]) => b.usedAt - a.usedAt)
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(key(userId), JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    // ignora
  }
}

// Sugestão pra descrição digitada: primeiro a mesma descrição, depois uma
// que comece com a mesma primeira palavra ("uber casa" -> "uber trabalho").
export function suggestFor(userId: string, description: string): RememberedEntry | null {
  const normalized = normalizeDescription(description);
  if (!userId || normalized.length < 3) return null;
  const all = readAll(userId);
  if (all[normalized]) return all[normalized];
  const firstWord = normalized.split(" ")[0];
  if (firstWord.length < 3) return null;
  const candidates = Object.entries(all)
    .filter(([text]) => text.split(" ")[0] === firstWord)
    .sort(([, a], [, b]) => b.usedAt - a.usedAt);
  return candidates[0]?.[1] ?? null;
}

// Descrições mais usadas por último, pra sugestão no campo (datalist).
export function recentDescriptions(userId: string, limit = 30): string[] {
  return Object.values(readAll(userId))
    .sort((a, b) => b.usedAt - a.usedAt)
    .slice(0, limit)
    .map((entry) => entry.description);
}

interface RepeatableTransaction {
  description: string;
  amount: string | number;
  transactionType: "expense" | "income";
  categoryId: string | null;
  accountId: string;
  paymentMethod: PaymentMethod | null;
}

// Link pra lançar de novo um gasto que já existe (mesmo valor, categoria,
// conta e forma de pagamento), com a data de hoje.
export function repeatHref(tx: RepeatableTransaction): string {
  const params = new URLSearchParams({ repetir: "1", d: tx.description, v: String(tx.amount), a: tx.accountId });
  if (tx.transactionType === "income") params.set("tipo", "receita");
  if (tx.categoryId) params.set("c", tx.categoryId);
  if (tx.paymentMethod) params.set("p", tx.paymentMethod);
  return `/transactions/new?${params.toString()}`;
}
