import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, personColor, tint } from "../utils/categoryColor";
import { formatCurrency, currentMonthParam } from "../utils/format";

interface AccountWithBalance {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  owner_user_id: string | null;
  balance: number;
}

interface MemberRow {
  id: string;
  display_name: string;
}

interface CoupleResponse {
  accounts: AccountWithBalance[];
  members: MemberRow[];
}

interface PayerSummaryRow {
  payer_id: string;
  total: string;
}

interface SummaryResponse {
  total: string;
  byPayer: PayerSummaryRow[];
}

interface BudgetResponse {
  budget: { cap_amount: string } | null;
  spent: number;
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
}

export function DashboardPage() {
  const { user, token } = useAuth();
  const [couple, setCouple] = useState<CoupleResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [recent, setRecent] = useState<TransactionListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);

  async function load() {
    setError(null);
    const month = currentMonthParam();
    try {
      const [coupleRes, summaryRes, budgetRes, recentRes] = await Promise.all([
        apiRequest<CoupleResponse>("/couples/me", { token }),
        apiRequest<SummaryResponse>(`/transactions/summary?month=${month}`, { token }),
        apiRequest<BudgetResponse>(`/budgets/current?month=${month}`, { token }),
        apiRequest<TransactionListRow[]>("/transactions?limit=5", { token }),
      ]);
      setCouple(coupleRes);
      setSummary(summaryRes);
      setBudget(budgetRes);
      setRecent(recentRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  if (error) {
    return (
      <AppLayout>
        <p className="alert" role="alert">
          {error}
        </p>
      </AppLayout>
    );
  }

  if (isLoading || !couple || !summary || !budget) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const jointAccount = couple.accounts.find((account) => account.type === "joint");
  const partner = couple.members.find((member) => member.id !== user?.id);

  const spentByUser = (userId: string | undefined) =>
    userId
      ? summary.byPayer.find((row) => row.payer_id === userId)?.total ?? "0"
      : "0";

  const cap = budget.budget ? Number(budget.budget.cap_amount) : null;
  const spent = budget.spent;
  const rawPercent = cap ? Math.round((spent / cap) * 100) : 0;
  const budgetPercent = Math.min(100, rawPercent);
  const budgetSeverity = rawPercent >= 100 ? "over" : rawPercent >= 80 ? "warning" : "";

  return (
    <AppLayout>
      <div className="dashboard">
        <div className="stat-card">
          <p className="label">Conta conjunta</p>
          <p className="value">{formatCurrency(jointAccount?.balance ?? 0)}</p>
        </div>

        <div className="stat-row">
          <div className="stat-box">
            <div className="stat-box-header">
              <span className="identity-dot" style={{ background: personColor(true) }} />
              <p className="label">Você</p>
            </div>
            <p className="value-sm">{formatCurrency(Number(spentByUser(user?.id)))}</p>
          </div>
          <div className="stat-box">
            <div className="stat-box-header">
              <span className="identity-dot" style={{ background: personColor(false) }} />
              <p className="label">{partner?.display_name ?? "Parceiro(a)"}</p>
            </div>
            <p className="value-sm">{formatCurrency(Number(spentByUser(partner?.id)))}</p>
          </div>
        </div>

        <div className="card budget-card">
          <div className="budget-header">
            <p className="card-title">Orçamento do mês</p>
            {cap ? (
              <span className="budget-amounts">
                {formatCurrency(spent)} / {formatCurrency(cap)}
              </span>
            ) : (
              <Link to="/account" className="link">
                Definir orçamento
              </Link>
            )}
          </div>
          {cap && (
            <>
              <div className="progress-track">
                <div
                  className={`progress-fill${budgetSeverity ? ` ${budgetSeverity}` : ""}`}
                  style={{ width: `${budgetPercent}%` }}
                />
              </div>
              {budgetSeverity && (
                <p className={`budget-status ${budgetSeverity}`}>
                  {budgetSeverity === "over" ? "⚠️ Passou do orçamento" : "⚠️ Perto do limite"}
                </p>
              )}
            </>
          )}
        </div>

        <div className="card">
          <div className="section-header">
            <p className="card-title">Extrato recente</p>
            <Link to="/reports" className="link">
              Ver tudo
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="empty-state">Nenhuma despesa lançada ainda.</p>
          ) : (
            <ul className="transaction-list">
              {recent.map((tx) => (
                <li key={tx.id} className="transaction-row">
                  <span
                    className="transaction-icon"
                    style={{ background: tint(categoryColor(tx.category_id)) }}
                  >
                    {tx.category_emoji ?? "💸"}
                  </span>
                  <div className="transaction-info">
                    <span className="transaction-desc">{tx.description}</span>
                    <span className="transaction-meta">
                      {tx.category_name ?? "Sem categoria"} ·{" "}
                      {new Date(tx.occurred_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <span className={`transaction-amount ${tx.transaction_type}`}>
                    {tx.transaction_type === "income" ? "+" : "-"}
                    {formatCurrency(Number(tx.amount))}
                  </span>
                  <button
                    type="button"
                    className="btn-icon"
                    title="Editar"
                    onClick={() => setEditingTx(tx)}
                  >
                    ✎
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Link to="/transactions/new" className="btn btn-primary fab-link">
          + Nova despesa
        </Link>
      </div>

      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={load}
        />
      )}
    </AppLayout>
  );
}
