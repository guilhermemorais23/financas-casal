import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryPieChart } from "../components/CategoryPieChart";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { IncomeExpenseDonut } from "../components/IncomeExpenseDonut";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { currentMonthParam, formatCurrency, groupByDay } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface CategorySummaryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

interface SummaryResponse {
  total: string;
  byCategory: CategorySummaryRow[];
}

interface TransactionListRow {
  id: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  occurredAt: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  isPrivate: boolean;
}

export function ReportsPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const cacheKey = (name: string, forMonth: string) => `reports:${name}:${forMonth}:${user?.id ?? "anon"}`;

  // Same URL-backed month as DashboardPage, so AppLayout's sidebar widgets
  // track whatever month is being browsed here instead of the real current
  // month.
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? currentMonthParam();
  function setMonth(nextMonth: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("month", nextMonth);
      return next;
    });
  }
  const [summary, setSummary] = useState<SummaryResponse | null>(() => readCache(cacheKey("summary", month)));
  const [transactions, setTransactions] = useState<TransactionListRow[] | null>(() =>
    readCache(cacheKey("transactions", month))
  );
  const [isLoading, setIsLoading] = useState(!summary);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  async function load(selectedMonth: string) {
    setIsLoading(true);
    const cached = readCache<SummaryResponse>(cacheKey("summary", selectedMonth));
    if (cached) {
      setSummary(cached);
      setTransactions(readCache(cacheKey("transactions", selectedMonth)));
    }
    try {
      const [summaryRes, txRes] = await Promise.all([
        apiRequest<SummaryResponse>(`/transactions/summary?month=${selectedMonth}&scope=visible`, { token }),
        apiRequest<TransactionListRow[]>(`/transactions?limit=100&month=${selectedMonth}`, { token }),
      ]);
      setSummary(summaryRes);
      setTransactions(txRes);
      writeCache(cacheKey("summary", selectedMonth), summaryRes);
      writeCache(cacheKey("transactions", selectedMonth), txRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os relatórios");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load(month);
    setSelectedCategoryId(null);
  }, [token, month]);

  async function handleExport() {
    setIsExporting(true);
    setError(null);
    try {
      await apiDownload(`/transactions/export?month=${month}`, token, `par-transacoes-${month}.csv`);
      showToast("CSV baixado");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível exportar");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Excluir esse lançamento?");
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);
    try {
      await apiRequest(`/transactions/${id}`, { method: "DELETE", token });
      await load(month);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir");
    } finally {
      setDeletingId(null);
    }
  }

  const visibleTransactions = useMemo(
    () =>
      (transactions ?? []).filter((tx) => {
        if (!selectedCategoryId) return true;
        if (selectedCategoryId === "none") return tx.categoryId === null;
        return tx.categoryId === selectedCategoryId;
      }),
    [transactions, selectedCategoryId]
  );
  const transactionGroups = useMemo(() => groupByDay(visibleTransactions), [visibleTransactions]);
  const selectedCategoryLabel = selectedCategoryId
    ? summary?.byCategory.find((row) => (row.categoryId ?? "none") === selectedCategoryId)
    : null;
  const { incomeTotal, expenseTotal } = useMemo(
    () => ({
      incomeTotal: (transactions ?? [])
        .filter((tx) => tx.transactionType === "income")
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
      expenseTotal: (transactions ?? [])
        .filter((tx) => tx.transactionType === "expense")
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
    }),
    [transactions]
  );
  const pieSlices = useMemo(
    () =>
      (summary?.byCategory ?? []).map((row) => ({
        id: row.categoryId ?? "none",
        label: row.categoryName ?? "Sem categoria",
        emoji: row.categoryEmoji,
        value: Number(row.total),
        color: categoryColor(row.categoryId),
      })),
    [summary]
  );

  return (
    <AppLayout>
      <div className="page-stack">
        {isLoading && <p className="refresh-note">Atualizando...</p>}
        <div className="section-header">
          <h1>Relatórios</h1>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleExport}
              disabled={isExporting || !transactions || transactions.length === 0}
              title="Baixar os lançamentos deste mês em CSV"
            >
              {isExporting ? "Baixando..." : "⬇ CSV"}
            </button>
          </div>
        </div>

        <div className="card">
          <p className="card-title">Receita x Gasto</p>
          {transactions && transactions.length === 0 ? (
            <p className="empty-state">Nenhuma transação neste mês.</p>
          ) : (
            <IncomeExpenseDonut income={incomeTotal} expense={expenseTotal} />
          )}
        </div>

        <div className="card">
          <p className="card-title">Por categoria</p>
          {summary && summary.byCategory.length === 0 ? (
            <p className="empty-state">Nenhuma despesa neste mês.</p>
          ) : (
            <CategoryPieChart
              slices={pieSlices}
              selectedId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />
          )}
        </div>

        <div className="card">
          <div className="section-header">
            <p className="card-title">
              Extrato
              {selectedCategoryLabel && ` · ${selectedCategoryLabel.categoryEmoji ?? "✨"} ${selectedCategoryLabel.categoryName ?? "Sem categoria"}`}
            </p>
            {selectedCategoryId && (
              <button type="button" className="link-button" onClick={() => setSelectedCategoryId(null)}>
                × Limpar filtro
              </button>
            )}
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {transactions && transactions.length > 0 && visibleTransactions.length === 0 && (
            <p className="empty-state">Nenhuma transação nessa categoria.</p>
          )}
          {transactions && transactions.length === 0 && (
            <p className="empty-state">Nenhuma transação neste mês.</p>
          )}
          <ul className="transaction-list">
            {transactionGroups.map((dayGroup) => (
              <Fragment key={dayGroup.label}>
                <li className="date-group-header">{dayGroup.label}</li>
                {dayGroup.items.map((tx) => (
                  <li key={tx.id} className="transaction-row">
                    <span
                      className="transaction-icon"
                      style={{ background: tint(categoryColor(tx.categoryId)) }}
                    >
                      {tx.categoryEmoji ?? "💸"}
                    </span>
                    <div className="transaction-info">
                      <span className="transaction-desc">
                        {tx.description}
                        {tx.isPrivate && <span className="badge private-badge">privado</span>}
                      </span>
                      <span className="transaction-meta">{tx.categoryName ?? "Sem categoria"}</span>
                    </div>
                    <span className={`transaction-amount ${tx.transactionType}`}>
                      {tx.transactionType === "income" ? "+" : "-"}
                      {formatCurrency(Number(tx.amount))}
                    </span>
                    <div className="transaction-row-actions">
                      <button type="button" className="btn-icon" title="Editar" onClick={() => setEditingTx(tx)}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Excluir"
                        disabled={deletingId === tx.id}
                        onClick={() => handleDelete(tx.id)}
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={() => load(month)}
        />
      )}
    </AppLayout>
  );
}
