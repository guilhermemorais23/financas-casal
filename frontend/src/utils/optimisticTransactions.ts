import { apiRequest, ApiError } from "../api/client";
import type { ToastOptions } from "../components/ToastProvider";
import { readCache, writeCache } from "./pageCache";
import { notifyDataChanged, trackWrite } from "./pendingWrites";
import type { PaymentMethod } from "./paymentMethod";

// A transaction as the lists show it. Fields the pages don't all use
// (isPrivate, accountType) are here so one shape can feed the Painel and the
// Relatórios caches.
export interface OptimisticTransaction {
  id: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  occurredAt: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  isPrivate: boolean;
  recurringGroupId: string | null;
  splitType: "none" | "equal";
  isSettled: boolean;
  accountId: string;
  accountType: "personal" | "joint";
  paymentMethod: PaymentMethod | null;
  payerId: string;
}

interface CategoryTotalRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

interface SummaryShape {
  total: string;
  byCategory: CategoryTotalRow[];
}

interface DashboardShape {
  recent: OptimisticTransaction[];
  summary: SummaryShape;
  personalMonthTotals: { income: number; expense: number };
}

function addToSummary(summary: SummaryShape, tx: OptimisticTransaction): SummaryShape {
  const amount = Number(tx.amount);
  const existing = summary.byCategory.find((row) => row.categoryId === tx.categoryId);
  const byCategory = existing
    ? summary.byCategory.map((row) =>
        row === existing ? { ...row, total: String(Number(row.total) + amount) } : row
      )
    : [
        ...summary.byCategory,
        { categoryId: tx.categoryId, categoryName: tx.categoryName, categoryEmoji: tx.categoryEmoji, total: String(amount) },
      ];
  byCategory.sort((a, b) => Number(b.total) - Number(a.total));
  return { total: String(Number(summary.total) + amount), byCategory };
}

// Paints the new transaction into whatever the Painel/Relatórios cached for
// its month, so those screens open already showing it -- before the server
// answered. Pages read this cache first and revalidate right after (the
// revalidation waits for pending writes, see utils/pendingWrites.ts).
function patchCaches(userId: string, tx: OptimisticTransaction, direction: 1 | -1): void {
  const month = tx.occurredAt.slice(0, 7);
  const uid = userId || "anon";

  const dashKey = `dashboard:full:${month}:${uid}`;
  const dash = readCache<DashboardShape>(dashKey);
  if (dash) {
    // Rolling back is simpler and safer as "forget it" than as arithmetic:
    // the next load refetches the truth.
    if (direction === -1) {
      writeCache(dashKey, null);
    } else {
      const next: DashboardShape = {
        ...dash,
        recent: [tx, ...dash.recent].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        summary: tx.transactionType === "expense" ? addToSummary(dash.summary, tx) : dash.summary,
        personalMonthTotals:
          tx.accountType === "personal"
            ? {
                ...dash.personalMonthTotals,
                [tx.transactionType]: dash.personalMonthTotals[tx.transactionType] + Number(tx.amount),
              }
            : dash.personalMonthTotals,
      };
      writeCache(dashKey, next);
    }
  }

  const listKey = `reports:transactions:${month}:${uid}`;
  const summaryKey = `reports:summary:${month}:${uid}`;
  const list = readCache<OptimisticTransaction[]>(listKey);
  const reportSummary = readCache<SummaryShape>(summaryKey);
  if (direction === -1) {
    if (list) writeCache(listKey, null);
    if (reportSummary) writeCache(summaryKey, null);
  } else {
    if (list) writeCache(listKey, [tx, ...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)));
    if (reportSummary && tx.transactionType === "expense") writeCache(summaryKey, addToSummary(reportSummary, tx));
  }
}

interface SaveInBackgroundArgs {
  token: string | null;
  userId: string;
  payload: Record<string, unknown>;
  optimistic: OptimisticTransaction;
  showToast: (message: string, options?: ToastOptions) => void;
}

// Fire-and-forget save: the caller has already navigated away and shown the
// "salvo" toast. If the server rejects it, the optimistic entry is rolled
// back and a toast offers "Tentar de novo" with the very same payload --
// nothing the person typed is lost.
export function saveTransactionInBackground(args: SaveInBackgroundArgs): void {
  const { token, userId, payload, optimistic, showToast } = args;
  patchCaches(userId, optimistic, 1);

  const request = trackWrite(apiRequest("/transactions", { method: "POST", token, body: payload }));
  request.catch((err) => {
    patchCaches(userId, optimistic, -1);
    notifyDataChanged();
    showToast(`Não salvou “${optimistic.description}”`, {
        variant: "error",
        description: err instanceof ApiError ? err.message : "Verifique a conexão e tente de novo",
        actionLabel: "Tentar de novo",
        durationMs: 10000,
        onAction: () => saveTransactionInBackground(args),
    });
  });
}
