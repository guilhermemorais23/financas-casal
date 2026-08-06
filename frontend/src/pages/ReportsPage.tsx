import { Fragment, useEffect, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryPieChart } from "../components/CategoryPieChart";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { IncomeExpenseDonut } from "../components/IncomeExpenseDonut";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { currentMonthParam, formatCurrency, groupByDay } from "../utils/format";

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
  const { token } = useAuth();
  const [month, setMonth] = useState(currentMonthParam());
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionListRow[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  async function load(selectedMonth: string) {
    const [summaryRes, txRes] = await Promise.all([
      apiRequest<SummaryResponse>(`/transactions/summary?month=${selectedMonth}&scope=visible`, { token }),
      apiRequest<TransactionListRow[]>(`/transactions?limit=100&month=${selectedMonth}`, { token }),
    ]);
    setSummary(summaryRes);
    setTransactions(txRes);
  }

  useEffect(() => {
    load(month);
    setSelectedCategoryId(null);
  }, [token, month]);

  async function handleDelete(id: string) {
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

  const visibleTransactions = (transactions ?? []).filter((tx) => {
    if (!selectedCategoryId) return true;
    if (selectedCategoryId === "none") return tx.categoryId === null;
    return tx.categoryId === selectedCategoryId;
  });
  const transactionGroups = groupByDay(visibleTransactions);
  const selectedCategoryLabel = selectedCategoryId
    ? summary?.byCategory.find((row) => (row.categoryId ?? "none") === selectedCategoryId)
    : null;
  const incomeTotal = (transactions ?? [])
    .filter((tx) => tx.transactionType === "income")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expenseTotal = (transactions ?? [])
    .filter((tx) => tx.transactionType === "expense")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="section-header">
          <h1>Relatórios</h1>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
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
              slices={(summary?.byCategory ?? []).map((row) => ({
                id: row.categoryId ?? "none",
                label: row.categoryName ?? "Sem categoria",
                emoji: row.categoryEmoji,
                value: Number(row.total),
                color: categoryColor(row.categoryId),
              }))}
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
