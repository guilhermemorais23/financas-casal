import { apiRequest, ApiError } from "../api/client";
import type { ToastOptions } from "../components/ToastProvider";
import { readCache, writeCache } from "./pageCache";
import { notifyDataChanged, trackWrite } from "./pendingWrites";
import type { PaymentMethod } from "./paymentMethod";

// Um lançamento como as listas mostram. Campos que nem toda tela usa
// (isPrivate, accountType) estão aqui pra um formato só alimentar os caches do
// Painel e de Relatórios.
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

// Desenha o lançamento novo no que o Painel e Relatórios guardaram no cache
// pro mês dele, pra essas telas já abrirem mostrando -- antes de o servidor
// responder. As telas leem este cache primeiro e conferem logo depois (a
// conferência espera as gravações pendentes, ver utils/pendingWrites.ts).
function patchCaches(userId: string, tx: OptimisticTransaction, direction: 1 | -1): void {
  const month = tx.occurredAt.slice(0, 7);
  const uid = userId || "anon";

  const dashKey = `dashboard:full:${month}:${uid}`;
  const dash = readCache<DashboardShape>(dashKey);
  if (dash) {
    // Voltar atrás é mais simples e seguro como "esquecer" do que como conta: o
    // próximo carregamento busca a verdade de novo.
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

// Gravação que dispara e esquece: quem chamou já saiu da tela e mostrou o
// aviso "salvo". Se o servidor recusar, o lançamento otimista é desfeito e
// um aviso oferece "Tentar de novo" com exatamente os mesmos dados -- nada
// que a pessoa digitou se perde.
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
