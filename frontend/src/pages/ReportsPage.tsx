import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { currentMonthParam, formatCurrency } from "../utils/format";

interface CategorySummaryRow {
  category_id: string | null;
  category_name: string | null;
  category_emoji: string | null;
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
  transaction_type: "expense" | "income";
  occurred_at: string;
  category_id: string | null;
  category_name: string | null;
  category_emoji: string | null;
  is_private: boolean;
}

export function ReportsPage() {
  const { token } = useAuth();
  const [month, setMonth] = useState(currentMonthParam());
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionListRow[] | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);

  async function load(selectedMonth: string) {
    const [summaryRes, txRes] = await Promise.all([
      apiRequest<SummaryResponse>(`/transactions/summary?month=${selectedMonth}`, { token }),
      apiRequest<TransactionListRow[]>(`/transactions?limit=100&month=${selectedMonth}`, { token }),
    ]);
    setSummary(summaryRes);
    setTransactions(txRes);
  }

  useEffect(() => {
    load(month);
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

  const total = summary ? Number(summary.total) : 0;

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="section-header">
          <h1>Relatórios</h1>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>

        <div className="card">
          <p className="card-title">Por categoria</p>
          {summary && summary.byCategory.length === 0 && (
            <p className="empty-state">Nenhuma despesa neste mês.</p>
          )}
          <ul className="category-breakdown">
            {summary?.byCategory.map((row) => {
              const value = Number(row.total);
              const percent = total > 0 ? Math.round((value / total) * 100) : 0;
              const color = categoryColor(row.category_id);
              return (
                <li key={row.category_id ?? "none"} className="category-row">
                  <div className="category-row-header">
                    <span className="category-name">
                      <span className="identity-dot" style={{ background: color }} />
                      {row.category_emoji ?? "✨"} {row.category_name ?? "Sem categoria"}
                    </span>
                    <span className="value">{formatCurrency(value)}</span>
                  </div>
                  <div className="progress-track thin">
                    <div className="progress-fill" style={{ width: `${percent}%`, background: color }} />
                  </div>
                </li>
              );
            })}
          </ul>
          {summary && summary.byCategory.length > 0 && (
            <p className="card-subtitle" style={{ marginTop: "1rem", marginBottom: 0 }}>
              Total do mês: <strong>{formatCurrency(total)}</strong>
            </p>
          )}
        </div>

        <div className="card">
          <p className="card-title">Extrato</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {transactions && transactions.length === 0 && (
            <p className="empty-state">Nenhuma transação neste mês.</p>
          )}
          <ul className="transaction-list">
            {transactions?.map((tx) => (
              <li key={tx.id} className="transaction-row">
                <span
                  className="transaction-icon"
                  style={{ background: tint(categoryColor(tx.category_id)) }}
                >
                  {tx.category_emoji ?? "💸"}
                </span>
                <div className="transaction-info">
                  <span className="transaction-desc">
                    {tx.description}
                    {tx.is_private && <span className="badge private-badge">privado</span>}
                  </span>
                  <span className="transaction-meta">
                    {tx.category_name ?? "Sem categoria"} ·{" "}
                    {new Date(tx.occurred_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <span className={`transaction-amount ${tx.transaction_type}`}>
                  {tx.transaction_type === "income" ? "+" : "-"}
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
                    ✕
                  </button>
                </div>
              </li>
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
