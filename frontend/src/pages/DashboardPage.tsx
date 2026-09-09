import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AccumulatedSpendingChart, type DailyTrendPoint } from "../components/AccumulatedSpendingChart";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { DashboardSkeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { CircularProgress } from "../components/CircularProgress";
import { EditRecurringModal } from "../components/EditRecurringModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { FinancialHealthBadge } from "../components/FinancialHealthBadge";
import { MonthPicker } from "../components/MonthPicker";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { SplitStatusPill } from "../components/SplitStatusPill";
import { TrendSparkline } from "../components/TrendSparkline";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, personColor, tint } from "../utils/categoryColor";
import {
  currentMonthParam,
  formatCurrency,
  groupByDay,
  monthLongName,
  nextMonthParam,
  parseLocalDate,
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
  splitType: "none" | "equal";
  isSettled: boolean;
  accountId: string;
  payerId: string;
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

interface PayerSummaryRow {
  payerId: string;
  total: string;
}

interface JointSummaryResponse {
  byPayer: PayerSummaryRow[];
}

interface BalanceRow {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

interface BalanceResponse {
  balances: BalanceRow[];
}

interface BudgetResponse {
  budget: { capAmount: string } | null;
  spent: number;
}

interface CategoryBudgetRow {
  categoryId: string;
  capAmount: string | null;
}

interface GoalHighlight {
  id: string;
  name: string;
  emoji: string | null;
  currentAmount: string;
  targetAmount: string;
}

interface NextInvoice {
  cardName: string;
  dueDate: string;
  total: string;
}

interface MonthlyTrendPoint {
  month: string;
  income: number;
  expense: number;
  net: number;
}

interface MonthTotals {
  income: number;
  expense: number;
}

interface DashboardResponse {
  group: GroupResponse;
  recent: TransactionListRow[];
  debts: DebtRow[];
  summary: SummaryResponse;
  jointSummary: JointSummaryResponse;
  balance: BalanceResponse;
  budget: BudgetResponse;
  categoryBudgets: CategoryBudgetRow[];
  dailyTrend: DailyTrendPoint[];
  personalMonthTotals: MonthTotals;
  personalPrevMonthTotals: MonthTotals;
  goalHighlight: GoalHighlight | null;
  nextInvoice: NextInvoice | null;
  trend6m: MonthlyTrendPoint[];
}

function daysUntil(dateStr: string): number {
  const date = parseLocalDate(dateStr);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(date) - startOfDay(today)) / 86_400_000);
}

function dueLabel(days: number): string {
  if (days < 0) return `venceu há ${Math.abs(days)} dia${Math.abs(days) > 1 ? "s" : ""}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
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
  const [personalMonthTotals, setPersonalMonthTotals] = useState<MonthTotals>(
    () => readCache(monthKey("personalMonthTotals")) ?? { income: 0, expense: 0 }
  );
  const [personalPrevMonthTotals, setPersonalPrevMonthTotals] = useState<MonthTotals>(
    () => readCache(monthKey("personalPrevMonthTotals")) ?? { income: 0, expense: 0 }
  );
  const [recent, setRecent] = useState<TransactionListRow[]>(() => readCache(monthKey("recent")) ?? []);
  const [dailyTrend, setDailyTrend] = useState<DailyTrendPoint[]>(() => readCache(monthKey("dailyTrend")) ?? []);
  const [debts, setDebts] = useState<DebtRow[]>(() => readCache(staticKey("debts")) ?? []);
  const [summary, setSummary] = useState<SummaryResponse | null>(() => readCache(monthKey("summary")));
  const [jointSummary, setJointSummary] = useState<JointSummaryResponse | null>(() =>
    readCache(monthKey("jointSummary"))
  );
  // Lifetime, not per-month (see dashboard.service.ts) -- cached under the
  // static key, same as group/debts.
  const [balance, setBalance] = useState<BalanceResponse | null>(() => readCache(staticKey("balance")));
  const [budget, setBudget] = useState<BudgetResponse | null>(() => readCache(monthKey("budget")));
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudgetRow[]>(
    () => readCache(monthKey("categoryBudgets")) ?? []
  );
  // Neither depends on the selected month (a goal/card due date isn't tied
  // to which month you're browsing) -- static key, same reasoning as
  // debts/balance above.
  const [goalHighlight, setGoalHighlight] = useState<GoalHighlight | null>(() =>
    readCache(staticKey("goalHighlight"))
  );
  const [nextInvoice, setNextInvoice] = useState<NextInvoice | null>(() => readCache(staticKey("nextInvoice")));
  const [trend6m, setTrend6m] = useState<MonthlyTrendPoint[]>(() => readCache(monthKey("trend6m")) ?? []);
  const [isLoading, setIsLoading] = useState(!group);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [editingRecurringTx, setEditingRecurringTx] = useState<TransactionListRow | null>(null);
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
      setPersonalMonthTotals(data.personalMonthTotals);
      setPersonalPrevMonthTotals(data.personalPrevMonthTotals);
      setRecent(data.recent);
      setDebts(data.debts);
      setSummary(data.summary);
      setJointSummary(data.jointSummary);
      setBalance(data.balance);
      setBudget(data.budget);
      setCategoryBudgets(data.categoryBudgets);
      setDailyTrend(data.dailyTrend);
      setGoalHighlight(data.goalHighlight);
      setNextInvoice(data.nextInvoice);
      setTrend6m(data.trend6m);
    }

    writeCache(sKey("group"), data.group);
    writeCache(sKey("debts"), data.debts);
    writeCache(sKey("balance"), data.balance);
    writeCache(sKey("goalHighlight"), data.goalHighlight);
    writeCache(sKey("nextInvoice"), data.nextInvoice);
    writeCache(mKey("personalMonthTotals"), data.personalMonthTotals);
    writeCache(mKey("personalPrevMonthTotals"), data.personalPrevMonthTotals);
    writeCache(mKey("recent"), data.recent);
    writeCache(mKey("summary"), data.summary);
    writeCache(mKey("jointSummary"), data.jointSummary);
    writeCache(mKey("budget"), data.budget);
    writeCache(mKey("categoryBudgets"), data.categoryBudgets);
    writeCache(mKey("dailyTrend"), data.dailyTrend);
    writeCache(mKey("trend6m"), data.trend6m);
    // The whole response, one key -- lets load() below check "do we already
    // have this month?" with a single readCache instead of guessing from
    // one field. This is what prefetchMonth's warm-up actually pays off:
    // without this, the neighbor-month prefetch below wrote a cache that
    // load() never consulted, so switching to an already-prefetched month
    // still paid a full network round trip for no reason.
    writeCache(mKey("full"), data);
  }

  // One request instead of the 7 separate ones this used to fire (group,
  // recent, debts, summary, budget, categoryBudgets, dailyTrend, plus 2 more
  // for personal tx this/prev month) -- each of those paid its own round
  // trip AND its own Firebase token verification on the backend, on top of
  // the Firestore reads (which already ran in parallel server-side either
  // way). GET /api/dashboard bundles the same reads into one response.
  // Tracks whichever month is *actually* selected right now, read inside
  // load()'s async callbacks -- state (`month`) can't be trusted there since
  // a slow response's continuation runs after later state updates. Without
  // this, switching quickly between months let an older, slower request's
  // response land last and overwrite a newer month's already-painted data
  // (and clear isLoading out from under whichever month is really pending).
  const activeMonthRef = useRef(month);
  activeMonthRef.current = month;

  // skipCache=true is what every post-mutation reload below uses: painting
  // the *previous* cached snapshot first would, for an instant, visually
  // undo the change that was just confirmed by the server (a settled split
  // flashing back to "open", a deleted transaction reappearing) before the
  // fresh fetch corrects it again. A plain month switch still wants the
  // cache-first paint -- that's the whole point of the neighbor prefetch.
  async function load(selectedMonth: string, options?: { skipCache?: boolean }) {
    setError(null);
    const mKeyLocal = (name: string) => `dashboard:${name}:${selectedMonth}:${user?.id ?? "anon"}`;
    const cached = options?.skipCache ? null : readCache<DashboardResponse>(mKeyLocal("full"));

    if (cached) {
      // Already warmed (a previous visit, or the neighbor-month prefetch
      // below) -- paint instantly, no loading state at all, then quietly
      // refetch underneath to catch anything that changed since.
      applyDashboard(selectedMonth, cached, false);
    } else if (selectedMonth === activeMonthRef.current) {
      setIsLoading(true);
    }

    try {
      const data = await apiRequest<DashboardResponse>(`/dashboard?month=${selectedMonth}`, { token });
      // The user may have already switched to a different month while this
      // was in flight -- an abandoned month's response is discarded instead
      // of overwriting whatever's actually on screen now. Still worth
      // caching (see writeCache below via applyDashboard), just not painted.
      const isStillActive = selectedMonth === activeMonthRef.current;
      applyDashboard(selectedMonth, data, !isStillActive);

      // Warm the cache for the months someone is likely to check next (back
      // and forth around whatever month they're on) so switching to one of
      // them later reads from cache instantly instead of waiting on a fresh
      // round trip. Runs after the visible month is done and on an idle
      // tick so it never competes with what's actually on screen.
      const prevMonth = previousMonthParam(selectedMonth);
      const nextMonth = nextMonthParam(selectedMonth);
      const neighborMonths = [
        prevMonth,
        previousMonthParam(prevMonth),
        nextMonth,
        nextMonthParam(nextMonth),
      ];
      idle(() => {
        neighborMonths.forEach((neighborMonth) => prefetchMonth(neighborMonth));
      });
    } catch (err) {
      // A month we already had cached still shows that cached data -- no
      // reason to blow it away with an error banner over a background
      // refresh failing silently (same "fail quiet" policy as prefetchMonth).
      // Also skip it for a month the user has already navigated away from.
      if (!cached && selectedMonth === activeMonthRef.current) {
        setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
      }
    } finally {
      if (selectedMonth === activeMonthRef.current) {
        setIsLoading(false);
      }
    }
  }

  // Best-effort background warm-up for a month not currently on screen --
  // writes only to cache (no setState, no error surfaced). Skips months
  // already cached so re-visiting the same couple of months doesn't refire
  // this on every mount. Checks the same "full" key load() actually reads,
  // not a different field -- otherwise the two checks can disagree and
  // this silently stops ever refreshing "full" for a month once any one
  // field of it happens to already be cached.
  async function prefetchMonth(targetMonth: string) {
    const mKey = (name: string) => `dashboard:${name}:${targetMonth}:${user?.id ?? "anon"}`;
    if (readCache(mKey("full"))) return;

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
      await load(month, { skipCache: true });
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
      await load(month, { skipCache: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível cancelar a recorrência");
    } finally {
      setDeletingId(null);
    }
  }

  // Local list update SplitStatusPill drives directly (optimistic flip,
  // reverted again if its request fails) -- see that component for the
  // actual settle/reopen calls.
  function setRecentSettled(transactionId: string, nextSettled: boolean) {
    setRecent((current) => current.map((row) => (row.id === transactionId ? { ...row, isSettled: nextSettled } : row)));
  }

  // Derived values below must stay above any conditional `return` -- they're
  // hooks (useMemo), and hook calls can't be conditional. Cheap arithmetic
  // (percentChange, budget math) stays as plain consts; the array-heavy work
  // (filtering/reducing up to 100 rows, regrouping by day) is memoized so
  // opening/closing a modal (editingTx/deletingId) doesn't redo it for no
  // reason -- none of those state changes affect this derived data.
  const income = personalMonthTotals.income;
  const expense = personalMonthTotals.expense;
  const prevIncome = personalPrevMonthTotals.income;
  const prevExpense = personalPrevMonthTotals.expense;
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

  const jointAccount = group?.accounts.find((account) => account.type === "joint");
  // Stable order: you first, then everyone else sorted by id -- same rule
  // ParPage uses, so color assignment doesn't jitter between the two pages.
  const orderedMembers = useMemo(() => {
    if (!group || !user) return [];
    const others = group.members.filter((member) => member.id !== user.id).sort((a, b) => a.id.localeCompare(b.id));
    return [{ id: user.id, displayName: "Você" }, ...others];
  }, [group, user]);
  const jointSpentByUser = (memberId: string) =>
    Number(jointSummary?.byPayer.find((row) => row.payerId === memberId)?.total ?? 0);
  const memberName = (memberId: string) =>
    memberId === user?.id ? "Você" : (group?.members.find((member) => member.id === memberId)?.displayName ?? "Alguém do grupo");

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
        <div className="section-header" style={{ alignItems: "flex-start" }}>
          <div className="dashboard-greeting">
            <h1>Olá, {user?.displayName?.split(" ")[0]} 👋</h1>
            <p className="card-subtitle">{monthLabel}</p>
            <FinancialHealthBadge monthlyIncome={income} monthlyExpense={expense} />
          </div>
          <MonthPicker value={month} onChange={setMonth} isLoading={isLoading} />
        </div>

        {/* Only visible while isLoading -- a month not already cached is
            being fetched for real. An already-cached month never sets
            isLoading, so switching between recently-viewed months never
            shows this at all. */}
        <div className={`top-progress${isLoading ? " is-loading" : ""}`} aria-hidden="true">
          <div className="top-progress-fill" />
        </div>

        <div className={`dashboard-content${isLoading ? " is-loading" : ""}`} aria-busy={isLoading}>
        <div className="stat-card wide">
          <span className="stat-card-circle" />
          <span className="stat-card-circle stat-card-circle-2" />
          <p className="label">Você tem no mês</p>
          <p className="value">
            <AnimatedNumber value={income - expense} />
          </p>
          {trend6m.length > 1 && (
            <div className="hero-trend">
              <TrendSparkline points={trend6m} />
            </div>
          )}
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

            {(goalHighlight || nextInvoice) && (
              <div className="card">
                <div className="dashboard-mini-grid">
                  {goalHighlight && (
                    <Link to="/goals" className="dashboard-mini-widget">
                      <CircularProgress
                        percent={
                          (Number(goalHighlight.currentAmount) / Number(goalHighlight.targetAmount)) * 100
                        }
                        size={48}
                        strokeWidth={5}
                        color="var(--color-primary)"
                      >
                        <span className="dashboard-mini-emoji">{goalHighlight.emoji ?? "🎯"}</span>
                      </CircularProgress>
                      <div className="dashboard-mini-text">
                        <p className="dashboard-mini-title">Meta</p>
                        <p className="dashboard-mini-name">{goalHighlight.name}</p>
                        <p className="dashboard-mini-sub">
                          {formatCurrency(Number(goalHighlight.currentAmount))} de{" "}
                          {formatCurrency(Number(goalHighlight.targetAmount))}
                        </p>
                      </div>
                    </Link>
                  )}
                  {nextInvoice && (
                    <Link to="/cards" className="dashboard-mini-widget">
                      <div className="dashboard-mini-text">
                        <p className="dashboard-mini-title">Próxima fatura</p>
                        <p className="dashboard-mini-name">{nextInvoice.cardName}</p>
                        <p
                          className={`dashboard-mini-sub${
                            daysUntil(nextInvoice.dueDate) <= 3 ? " danger-text" : ""
                          }`}
                        >
                          {formatCurrency(Number(nextInvoice.total))} · {dueLabel(daysUntil(nextInvoice.dueDate))}
                        </p>
                      </div>
                    </Link>
                  )}
                </div>
              </div>
            )}

            {jointAccount && orderedMembers.length > 1 && (
              <div className="card">
                <div className="section-header">
                  <p className="card-title">Par</p>
                  <Link to="/par" className="link">
                    Ver Par
                  </Link>
                </div>
                <p className="card-subtitle">O que vocês gastaram juntos esse mês, e quem pagou quanto.</p>
                <p className="value-sm" style={{ marginBottom: "0.75rem" }}>
                  {jointAccount.name}: {formatCurrency(jointAccount.balance)}
                </p>
                <div className="stat-row wrap">
                  {orderedMembers.map((member, index) => (
                    <div
                      className="stat-box"
                      key={member.id}
                      style={{
                        ["--stat-box-accent" as string]: personColor(index),
                        background: tint(personColor(index)),
                      }}
                    >
                      <div className="stat-box-header">
                        <span className="identity-dot" style={{ background: personColor(index) }} />
                        <p className="label">{member.id === user?.id ? "Você" : member.displayName}</p>
                      </div>
                      <p className="value-sm">{formatCurrency(jointSpentByUser(member.id))}</p>
                    </div>
                  ))}
                </div>
                {balance && balance.balances.length > 0 && (
                  <p className="card-subtitle" style={{ marginTop: "0.75rem" }}>
                    Divisões em aberto:{" "}
                    {balance.balances
                      .map((row) =>
                        row.fromUserId === user?.id
                          ? `${formatCurrency(row.amount)} a pagar pra ${memberName(row.toUserId)}`
                          : row.toUserId === user?.id
                            ? `${formatCurrency(row.amount)} a receber de ${memberName(row.fromUserId)}`
                            : `${formatCurrency(row.amount)} entre ${memberName(row.fromUserId)} e ${memberName(row.toUserId)}`
                      )
                      .join(" · ")}
                  </p>
                )}
              </div>
            )}

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
                            <span className="transaction-meta">
                              {tx.categoryName ?? "Sem categoria"}
                              {tx.splitType === "equal" && (
                                <SplitStatusPill
                                  token={token}
                                  transactionId={tx.id}
                                  totalAmount={Number(tx.amount)}
                                  isSettled={tx.isSettled}
                                  onOptimisticChange={(next) => setRecentSettled(tx.id, next)}
                                  onSettled={() => load(month, { skipCache: true })}
                                  onError={(message) => setError(message)}
                                />
                              )}
                            </span>
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
                            <RowActionsMenu
                              actions={[
                                ...(tx.recurringGroupId
                                  ? [
                                      {
                                        key: "edit-recurring",
                                        label: "Editar valor da recorrência",
                                        icon: "✏️🔁",
                                        onClick: () => setEditingRecurringTx(tx),
                                      },
                                      {
                                        key: "cancel-recurring",
                                        label: "Cancelar recorrência",
                                        icon: "🔁🚫",
                                        disabled: deletingId === tx.id,
                                        onClick: () => handleCancelRecurring(tx.id),
                                      },
                                    ]
                                  : []),
                                {
                                  key: "delete",
                                  label: "Excluir",
                                  icon: "🗑",
                                  disabled: deletingId === tx.id,
                                  danger: true,
                                  onClick: () => handleDelete(tx.id),
                                },
                              ]}
                            />
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
      </div>

      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={() => load(month, { skipCache: true })}
        />
      )}
      {editingRecurringTx && (
        <EditRecurringModal
          transaction={editingRecurringTx}
          onClose={() => setEditingRecurringTx(null)}
          onSaved={() => load(month, { skipCache: true })}
        />
      )}
    </AppLayout>
  );
}
