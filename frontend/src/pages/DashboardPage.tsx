import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { FinancialHealthBadge } from "../components/FinancialHealthBadge";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import {
  currentMonthParam,
  formatCurrency,
  groupByDay,
  monthLongName,
  percentChange,
  previousMonthParam,
} from "../utils/format";

interface AccountWithBalance {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  ownerUserId: string | null;
  balance: number;
}

interface MemberRow {
  id: string;
  displayName: string;
}

interface GroupResponse {
  accounts: AccountWithBalance[];
  members: MemberRow[];
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
}

interface DebtRow {
  id: string;
  name: string;
  totalAmount: string;
  installmentsCount: number;
  paidAmount: number;
  remainingAmount: number;
  remainingCount: number;
}

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

interface BudgetResponse {
  budget: { capAmount: string } | null;
  spent: number;
}

export function DashboardPage() {
  const { user, token } = useAuth();
  const [month, setMonth] = useState(currentMonthParam());
  const [group, setGroup] = useState<GroupResponse | null>(null);
  const [personalMonthTx, setPersonalMonthTx] = useState<TransactionListRow[]>([]);
  const [personalPrevMonthTx, setPersonalPrevMonthTx] = useState<TransactionListRow[]>([]);
  const [recent, setRecent] = useState<TransactionListRow[]>([]);
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load(selectedMonth: string) {
    setError(null);
    const prevMonth = previousMonthParam(selectedMonth);
    try {
      const groupRes = await apiRequest<GroupResponse>("/groups/me", { token });
      const personalAccount = groupRes.accounts.find(
        (account) => account.type === "personal" && account.ownerUserId === user?.id
      );

      const [personalMonthRes, personalPrevMonthRes, recentRes, debtsRes, summaryRes, budgetRes] =
        await Promise.all([
          personalAccount
            ? apiRequest<TransactionListRow[]>(
                `/transactions?limit=100&month=${selectedMonth}&accountId=${personalAccount.id}`,
                { token }
              )
            : Promise.resolve([]),
          personalAccount
            ? apiRequest<TransactionListRow[]>(
                `/transactions?limit=100&month=${prevMonth}&accountId=${personalAccount.id}`,
                { token }
              )
            : Promise.resolve([]),
          apiRequest<TransactionListRow[]>(`/transactions?limit=8&month=${selectedMonth}`, { token }),
          apiRequest<DebtRow[]>("/debts", { token }),
          apiRequest<SummaryResponse>(`/transactions/summary?month=${selectedMonth}&scope=visible`, { token }),
          apiRequest<BudgetResponse>(`/budgets/current?month=${selectedMonth}`, { token }),
        ]);

      setGroup(groupRes);
      setPersonalMonthTx(personalMonthRes);
      setPersonalPrevMonthTx(personalPrevMonthRes);
      setRecent(recentRes);
      setDebts(debtsRes);
      setSummary(summaryRes);
      setBudget(budgetRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
    } finally {
      setIsLoading(false);
    }
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

  if (error) {
    return (
      <AppLayout>
        <p className="alert" role="alert">
          {error}
        </p>
      </AppLayout>
    );
  }

  if (isLoading || !group) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const sumByType = (rows: TransactionListRow[], type: "income" | "expense") =>
    rows.filter((tx) => tx.transactionType === type).reduce((sum, tx) => sum + Number(tx.amount), 0);

  const income = sumByType(personalMonthTx, "income");
  const expense = sumByType(personalMonthTx, "expense");
  const prevIncome = sumByType(personalPrevMonthTx, "income");
  const prevExpense = sumByType(personalPrevMonthTx, "expense");
  const incomeDelta = percentChange(income, prevIncome);
  const expenseDelta = percentChange(expense, prevExpense);
  const prevMonthName = monthLongName(previousMonthParam(month));
  const monthLabel = `${monthLongName(month)} de ${month.slice(0, 4)}`;

  const activeDebts = debts.filter((debt) => debt.remainingAmount > 0);
  const totalDebtRemaining = activeDebts.reduce((sum, debt) => sum + debt.remainingAmount, 0);

  const topCategories = summary?.byCategory.slice(0, 4) ?? [];
  const topCategoriesTotal = topCategories.reduce((sum, row) => sum + Number(row.total), 0);

  const cap = budget?.budget ? Number(budget.budget.capAmount) : null;
  const spent = budget?.spent ?? 0;
  const budgetRawPercent = cap ? (spent / cap) * 100 : 0;
  const budgetPercent = Math.min(100, budgetRawPercent);
  const budgetSeverity = budgetRawPercent >= 100 ? "over" : budgetRawPercent >= 80 ? "warning" : "";

  const recentGroups = groupByDay(recent);

  return (
    <AppLayout wide>
      <div className="dashboard">
        <div className="section-header" style={{ alignItems: "flex-start" }}>
          <div className="dashboard-greeting">
            <h1>Olá, {user?.displayName?.split(" ")[0]} 👋</h1>
            <p className="card-subtitle">{monthLabel}</p>
            <FinancialHealthBadge monthlyIncome={income} monthlyExpense={expense} />
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>

        <div className="stat-row wrap">
          <div className="stat-box tone-good">
            <p className="label">Entrada do mês</p>
            <p className="value-sm income-text">{formatCurrency(income)}</p>
            {incomeDelta !== null && (
              <p className={`stat-delta ${incomeDelta >= 0 ? "good" : "bad"}`}>
                {incomeDelta >= 0 ? "+" : ""}
                {Math.round(incomeDelta)}% vs {prevMonthName}
              </p>
            )}
          </div>
          <div className="stat-box tone-warm">
            <p className="label">Saída do mês</p>
            <p className="value-sm">{formatCurrency(expense)}</p>
            {expenseDelta !== null && (
              <p className={`stat-delta ${expenseDelta <= 0 ? "good" : "bad"}`}>
                {expenseDelta >= 0 ? "+" : ""}
                {Math.round(expenseDelta)}% vs {prevMonthName}
              </p>
            )}
          </div>
          <div className="stat-box tone-accent">
            <p className="label">Você tem no mês</p>
            <p className={`value-sm ${income - expense >= 0 ? "income-text" : "danger-text"}`}>
              {formatCurrency(income - expense)}
            </p>
          </div>
        </div>

        <div className="dashboard-grid">
          <div className="dashboard-col">
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
                <p className="card-title">Maiores gastos do mês</p>
                <Link to="/reports" className="link">
                  Ver relatório
                </Link>
              </div>
              {topCategories.length === 0 ? (
                <p className="empty-state">Nenhuma despesa neste mês.</p>
              ) : (
                <ul className="category-breakdown">
                  {topCategories.map((row) => {
                    const value = Number(row.total);
                    const percent =
                      topCategoriesTotal > 0 ? Math.round((value / topCategoriesTotal) * 100) : 0;
                    const color = categoryColor(row.categoryId);
                    return (
                      <li key={row.categoryId ?? "none"}>
                        <div className="category-row-header">
                          <span className="category-name">
                            <span className="identity-dot" style={{ background: color }} />
                            {row.categoryEmoji ?? "✨"} {row.categoryName ?? "Sem categoria"}
                          </span>
                          <span className="value">
                            {formatCurrency(value)} <span className="donut-legend-percent">({percent}%)</span>
                          </span>
                        </div>
                        <div className="progress-track thin">
                          <div className="progress-fill" style={{ width: `${percent}%`, background: color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <div className="section-header">
                <p className="card-title">Dívidas</p>
                <Link to="/debts" className="link">
                  Ver tudo
                </Link>
              </div>
              {activeDebts.length === 0 ? (
                <div className="empty-state-friendly">
                  <span className="empty-state-emoji">🎉</span>
                  <p>Nenhuma dívida pendente!</p>
                </div>
              ) : (
                <>
                  <p className="value-sm danger-text">{formatCurrency(totalDebtRemaining)}</p>
                  <p className="card-subtitle" style={{ marginBottom: "0.9rem" }}>
                    pendente em {activeDebts.length} dívida{activeDebts.length > 1 ? "s" : ""}
                  </p>
                  <ul className="category-breakdown">
                    {activeDebts.slice(0, 3).map((debt) => {
                      const percent = Math.round((debt.paidAmount / Number(debt.totalAmount)) * 100);
                      return (
                        <li key={debt.id}>
                          <div className="category-row-header">
                            <span>💳 {debt.name}</span>
                            <span className="value">{formatCurrency(debt.remainingAmount)}</span>
                          </div>
                          <div className="progress-track thin">
                            <div className="progress-fill" style={{ width: `${percent}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </div>

          <div className="dashboard-col">
            <div className="card">
              <div className="section-header">
                <p className="card-title">Extrato do mês</p>
                <Link to="/reports" className="link">
                  Ver tudo
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="empty-state">Nenhuma despesa lançada neste mês.</p>
              ) : (
                <ul className="transaction-list">
                  {recentGroups.map((dayGroup) => (
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
                            <span className="transaction-desc">{tx.description}</span>
                            <span className="transaction-meta">{tx.categoryName ?? "Sem categoria"}</span>
                          </div>
                          <span className={`transaction-amount ${tx.transactionType}`}>
                            {tx.transactionType === "income" ? "+" : "-"}
                            {formatCurrency(Number(tx.amount))}
                          </span>
                          <div className="transaction-row-actions">
                            <button
                              type="button"
                              className="btn-icon"
                              title="Editar"
                              onClick={() => setEditingTx(tx)}
                            >
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
              )}
            </div>
          </div>
        </div>

        <Link to="/transactions/new" className="btn btn-primary fab-link">
          + Nova despesa
        </Link>
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
