import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AccumulatedSpendingChart, type DailyTrendPoint } from "../components/AccumulatedSpendingChart";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DashboardSkeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { CircularProgress } from "../components/CircularProgress";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { FinancialHealthBadge } from "../components/FinancialHealthBadge";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import {
  currentMonthParam,
  formatCurrency,
  groupByDay,
  monthLongName,
  nextMonthParam,
  percentChange,
  previousMonthParam,
} from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

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
  recurringGroupId: string | null;
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

interface CategoryBudgetRow {
  categoryId: string;
  capAmount: string | null;
}

interface DashboardResponse {
  group: GroupResponse;
  recent: TransactionListRow[];
  debts: DebtRow[];
  summary: SummaryResponse;
  budget: BudgetResponse;
  categoryBudgets: CategoryBudgetRow[];
  dailyTrend: DailyTrendPoint[];
  personalMonthTx: TransactionListRow[];
  personalPrevMonthTx: TransactionListRow[];
}

function sumByType(rows: TransactionListRow[], type: "income" | "expense") {
  return rows.filter((tx) => tx.transactionType === type).reduce((sum, tx) => sum + Number(tx.amount), 0);
}

export function DashboardPage() {
  const { user, token } = useAuth();
  // Kept in the URL (not just local state) so the sidebar in AppLayout --
  // which fetches its own "spending this month" widgets -- can read the
  // same selected month instead of always defaulting to the real current
  // month, which was confusing when browsing a different month here.
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get("month") ?? currentMonthParam();
  function setMonth(nextMonth: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("month", nextMonth);
      return next;
    });
  }

  const staticKey = (name: string) => `dashboard:${name}:${user?.id ?? "anon"}`;
  const monthKey = (name: string) => `dashboard:${name}:${month}:${user?.id ?? "anon"}`;

  const [group, setGroup] = useState<GroupResponse | null>(() => readCache(staticKey("group")));
  const [personalMonthTx, setPersonalMonthTx] = useState<TransactionListRow[]>(
    () => readCache(monthKey("personalMonthTx")) ?? []
  );
  const [personalPrevMonthTx, setPersonalPrevMonthTx] = useState<TransactionListRow[]>(
    () => readCache(monthKey("personalPrevMonthTx")) ?? []
  );
  const [recent, setRecent] = useState<TransactionListRow[]>(() => readCache(monthKey("recent")) ?? []);
  const [dailyTrend, setDailyTrend] = useState<DailyTrendPoint[]>(() => readCache(monthKey("dailyTrend")) ?? []);
  const [debts, setDebts] = useState<DebtRow[]>(() => readCache(staticKey("debts")) ?? []);
  const [summary, setSummary] = useState<SummaryResponse | null>(() => readCache(monthKey("summary")));
  const [budget, setBudget] = useState<BudgetResponse | null>(() => readCache(monthKey("budget")));
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudgetRow[]>(
    () => readCache(monthKey("categoryBudgets")) ?? []
  );
  const [isLoading, setIsLoading] = useState(!group);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const idle = (cb: () => void) =>
    typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb) : setTimeout(cb, 300);

  // warmCacheOnly=true is what prefetchMonth uses for a month not on screen
  // -- writes the cache same as a real load, but never touches component
  // state (nothing should visibly change just because a background prefetch
  // finished).
  function applyDashboard(selectedMonth: string, data: DashboardResponse, warmCacheOnly: boolean) {
    const sKey = (name: string) => `dashboard:${name}:${user?.id ?? "anon"}`;
    const mKey = (name: string) => `dashboard:${name}:${selectedMonth}:${user?.id ?? "anon"}`;

    if (!warmCacheOnly) {
      setGroup(data.group);
      setPersonalMonthTx(data.personalMonthTx);
      setPersonalPrevMonthTx(data.personalPrevMonthTx);
      setRecent(data.recent);
      setDebts(data.debts);
      setSummary(data.summary);
      setBudget(data.budget);
      setCategoryBudgets(data.categoryBudgets);
      setDailyTrend(data.dailyTrend);
    }

    writeCache(sKey("group"), data.group);
    writeCache(sKey("debts"), data.debts);
    writeCache(mKey("personalMonthTx"), data.personalMonthTx);
    writeCache(mKey("personalPrevMonthTx"), data.personalPrevMonthTx);
    writeCache(mKey("recent"), data.recent);
    writeCache(mKey("summary"), data.summary);
    writeCache(mKey("budget"), data.budget);
    writeCache(mKey("categoryBudgets"), data.categoryBudgets);
    writeCache(mKey("dailyTrend"), data.dailyTrend);
  }

  // One request instead of the 7 separate ones this used to fire (group,
  // recent, debts, summary, budget, categoryBudgets, dailyTrend, plus 2 more
  // for personal tx this/prev month) -- each of those paid its own round
  // trip AND its own Firebase token verification on the backend, on top of
  // the Firestore reads (which already ran in parallel server-side either
  // way). GET /api/dashboard bundles the same reads into one response.
  async function load(selectedMonth: string) {
    setError(null);
    try {
      const data = await apiRequest<DashboardResponse>(`/dashboard?month=${selectedMonth}`, { token });
      applyDashboard(selectedMonth, data, false);

      // Warm the cache for the months someone is likely to check next (back
      // and forth around whatever month they're on) so switching to one of
      // them later reads from cache instantly instead of waiting on a fresh
      // round trip. Runs after the visible month is done and on an idle
      // tick so it never competes with what's actually on screen.
      const prevMonth = previousMonthParam(selectedMonth);
      const neighborMonths = [prevMonth, previousMonthParam(prevMonth), nextMonthParam(selectedMonth)];
      idle(() => {
        neighborMonths.forEach((neighborMonth) => prefetchMonth(neighborMonth));
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
    } finally {
      setIsLoading(false);
    }
  }

  // Best-effort background warm-up for a month not currently on screen --
  // writes only to cache (no setState, no error surfaced). Skips months
  // already cached so re-visiting the same couple of months doesn't refire
  // this on every mount.
  async function prefetchMonth(targetMonth: string) {
    const mKey = (name: string) => `dashboard:${name}:${targetMonth}:${user?.id ?? "anon"}`;
    if (readCache(mKey("summary"))) return;

    try {
      const data = await apiRequest<DashboardResponse>(`/dashboard?month=${targetMonth}`, { token });
      applyDashboard(targetMonth, data, true);
    } catch {
      // A failed prefetch just means that month loads from the network like
      // normal, the same as before this existed -- never worth surfacing.
    }
  }

  useEffect(() => {
    load(month);
  }, [token, month]);

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

  async function handleCancelRecurring(id: string) {
    const confirmed = window.confirm("Cancelar essa recorrência? Este lançamento e os dos próximos meses somem.");
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);
    try {
      await apiRequest(`/transactions/${id}/recurring`, { method: "DELETE", token });
      await load(month);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível cancelar a recorrência");
    } finally {
      setDeletingId(null);
    }
  }

  // Derived values below must stay above any conditional `return` -- they're
  // hooks (useMemo), and hook calls can't be conditional. Cheap arithmetic
  // (percentChange, budget math) stays as plain consts; the array-heavy work
  // (filtering/reducing up to 100 rows, regrouping by day) is memoized so
  // opening/closing a modal (editingTx/deletingId) doesn't redo it for no
  // reason -- none of those state changes affect this derived data.
  const income = useMemo(() => sumByType(personalMonthTx, "income"), [personalMonthTx]);
  const expense = useMemo(() => sumByType(personalMonthTx, "expense"), [personalMonthTx]);
  const prevIncome = useMemo(() => sumByType(personalPrevMonthTx, "income"), [personalPrevMonthTx]);
  const prevExpense = useMemo(() => sumByType(personalPrevMonthTx, "expense"), [personalPrevMonthTx]);
  const incomeDelta = percentChange(income, prevIncome);
  const expenseDelta = percentChange(expense, prevExpense);
  const prevMonthName = monthLongName(previousMonthParam(month));
  const monthLabel = `${monthLongName(month)} de ${month.slice(0, 4)}`;

  const { activeDebts, totalDebtRemaining } = useMemo(() => {
    const active = debts.filter((debt) => debt.remainingAmount > 0);
    return { activeDebts: active, totalDebtRemaining: active.reduce((sum, debt) => sum + debt.remainingAmount, 0) };
  }, [debts]);

  const { topCategories, topCategoriesTotal } = useMemo(() => {
    const top = summary?.byCategory.slice(0, 4) ?? [];
    return { topCategories: top, topCategoriesTotal: top.reduce((sum, row) => sum + Number(row.total), 0) };
  }, [summary]);

  const categoryCapById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of categoryBudgets) {
      if (row.capAmount !== null) map.set(row.categoryId, Number(row.capAmount));
    }
    return map;
  }, [categoryBudgets]);

  const cap = budget?.budget ? Number(budget.budget.capAmount) : null;
  const spent = budget?.spent ?? 0;
  const budgetRawPercent = cap ? (spent / cap) * 100 : 0;
  const budgetPercent = Math.min(100, budgetRawPercent);
  const budgetSeverity = budgetRawPercent >= 100 ? "over" : budgetRawPercent >= 80 ? "warning" : "";

  const recentGroups = useMemo(() => groupByDay(recent), [recent]);

  if (error && !group) {
    return (
      <AppLayout wide>
        <p className="alert" role="alert">
          {error}
        </p>
      </AppLayout>
    );
  }

  if (!group) {
    return (
      <AppLayout wide>
        <DashboardSkeleton />
      </AppLayout>
    );
  }

  return (
    <AppLayout wide>
      <div className="dashboard">
        {isLoading && <p className="refresh-note">Atualizando...</p>}
        <div className="section-header" style={{ alignItems: "flex-start" }}>
          <div className="dashboard-greeting">
            <h1>Olá, {user?.displayName?.split(" ")[0]} 👋</h1>
            <p className="card-subtitle">{monthLabel}</p>
            <FinancialHealthBadge monthlyIncome={income} monthlyExpense={expense} />
          </div>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>

        <div className="stat-card wide">
          <span className="stat-card-circle" />
          <span className="stat-card-circle stat-card-circle-2" />
          <p className="label">Você tem no mês</p>
          <p className="value">
            <AnimatedNumber value={income - expense} />
          </p>
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
        </div>

        {(cap !== null || totalDebtRemaining > 0) && (
          <div className="stat-row wrap">
            {cap !== null && (
              <div className="stat-box">
                <p className="label">Orçamento usado</p>
                <p className="value-sm">{Math.round(budgetRawPercent)}%</p>
              </div>
            )}
            {totalDebtRemaining > 0 && (
              <div className="stat-box">
                <p className="label">Dívidas em aberto</p>
                <p className="value-sm">{formatCurrency(totalDebtRemaining)}</p>
              </div>
            )}
          </div>
        )}

        <div className="dashboard-grid">
          <div className="dashboard-col">
            <div className={`card budget-card${cap ? "" : " is-empty"}`}>
              <span className="stat-card-circle" />
              <span className="stat-card-circle stat-card-circle-2" />
              <div className="budget-header">
                <p className="card-title">Orçamento do mês</p>
                {!cap && (
                  <Link to="/account" className="link">
                    Definir orçamento
                  </Link>
                )}
              </div>
              {cap ? (
                <div className="budget-ring-row">
                  <CircularProgress
                    percent={budgetPercent}
                    size={92}
                    strokeWidth={9}
                    trackColor="rgba(247, 239, 229, 0.25)"
                    color={
                      budgetSeverity === "over"
                        ? "var(--status-critical)"
                        : budgetSeverity === "warning"
                          ? "var(--status-warning)"
                          : "var(--peach)"
                    }
                  >
                    <span className="budget-ring-percent">{Math.round(budgetRawPercent)}%</span>
                  </CircularProgress>
                  <div className="budget-ring-details">
                    <span className="budget-amounts">
                      {formatCurrency(spent)} de {formatCurrency(cap)}
                    </span>
                    <p className={`budget-status ${budgetSeverity || "good"}`}>
                      {budgetSeverity === "over"
                        ? "⚠️ Passou do orçamento"
                        : budgetSeverity === "warning"
                          ? "⚠️ Perto do limite"
                          : "✅ Tudo sob controle"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="empty-state">Defina um teto mensal na Conta pra acompanhar aqui.</p>
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
                <div className="category-gauge-grid">
                  {topCategories.map((row) => {
                    const value = Number(row.total);
                    const percent =
                      topCategoriesTotal > 0 ? Math.round((value / topCategoriesTotal) * 100) : 0;
                    const color = categoryColor(row.categoryId);
                    const categoryCap = row.categoryId ? categoryCapById.get(row.categoryId) : undefined;
                    const capRawPercent = categoryCap ? (value / categoryCap) * 100 : 0;
                    const capSeverity = capRawPercent >= 100 ? "over" : capRawPercent >= 80 ? "warning" : "good";
                    return (
                      <div className="category-gauge-item" key={row.categoryId ?? "none"}>
                        <CircularProgress percent={percent} size={72} strokeWidth={7} color={color}>
                          <span className="category-gauge-emoji">{row.categoryEmoji ?? "✨"}</span>
                        </CircularProgress>
                        <span className="category-gauge-name">{row.categoryName ?? "Sem categoria"}</span>
                        <span className="category-gauge-amount">{formatCurrency(value)}</span>
                        {categoryCap ? (
                          <>
                            <div className="category-gauge-bar-track">
                              <div
                                className="category-gauge-bar-fill"
                                style={{
                                  width: `${Math.min(100, capRawPercent)}%`,
                                  background:
                                    capSeverity === "over"
                                      ? "var(--status-critical)"
                                      : capSeverity === "warning"
                                        ? "var(--status-warning)"
                                        : "var(--success-text)",
                                }}
                              />
                            </div>
                            <span className={`category-gauge-bar-label ${capSeverity}`}>
                              {Math.round(capRawPercent)}% de {formatCurrency(categoryCap)}
                            </span>
                          </>
                        ) : (
                          row.categoryId && <span className="category-gauge-no-cap">sem teto definido</span>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                <EmptyState icon="🎉">Nenhuma dívida pendente!</EmptyState>
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
            {dailyTrend.length > 0 && (
              <div className="card">
                <p className="card-title">Gastos acumulados</p>
                <p className="card-subtitle">
                  {monthLongName(month)} · {user?.displayName?.split(" ")[0]}
                </p>
                <AccumulatedSpendingChart points={dailyTrend} />
              </div>
            )}

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
                            <span className="transaction-desc">
                              {tx.description}
                              {tx.recurringGroupId && <span className="badge recurring-badge" title="Recorrente">🔁</span>}
                            </span>
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
                            {tx.recurringGroupId && (
                              <button
                                type="button"
                                className="btn-icon"
                                title="Cancelar recorrência"
                                disabled={deletingId === tx.id}
                                onClick={() => handleCancelRecurring(tx.id)}
                              >
                                🔁🚫
                              </button>
                            )}
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
