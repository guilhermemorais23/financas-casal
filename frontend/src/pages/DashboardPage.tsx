import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { type DailyTrendPoint } from "../components/AccumulatedSpendingChart";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { DashboardSkeleton } from "../components/Skeleton";
import { Icon } from "../components/Icon";
import { CircularProgress } from "../components/CircularProgress";
import { EditRecurringModal } from "../components/EditRecurringModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { FinancialHealthBadge } from "../components/FinancialHealthBadge";
import { ImportStatementModal } from "../components/ImportStatementModal";
import { UncategorizedModal } from "../components/UncategorizedModal";
import { MonthPicker } from "../components/MonthPicker";
import { MonthCloseCard } from "../components/MonthCloseCard";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { repeatHref } from "../utils/quickEntry";
import { SplitStatusPill } from "../components/SplitStatusPill";
import { SplitSummary } from "../components/SplitSummary";
import { AppLayout } from "../layouts/AppLayout";
import { personColor } from "../utils/categoryColor";
import {
  currentMonthParam,
  formatCurrency,
  groupByDay,
  monthLongName,
  parseLocalDate,
  percentChange,
  previousMonthParam,
} from "../utils/format";
import { cancelDeferred, isDeferredPending, scheduleDeferred } from "../utils/deferredDelete";
import { readCache, writeCache } from "../utils/pageCache";
import { DATA_CHANGED_EVENT, whenWritesSettled } from "../utils/pendingWrites";
import { paymentMethodLabel, type PaymentMethod } from "../utils/paymentMethod";
import { initialOf } from "../utils/initial";
import { isLinkedTransaction, type LinkKind } from "../utils/linkedTransaction";
import { BillRemindersCard } from "../components/BillReminders";
import { BalanceLineChart, InOutMonthsChart } from "../components/PainelCharts";
import { minimumMonthlySaving } from "../utils/goals";

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
  splitType: "none" | "equal" | "custom";
  isSettled: boolean;
  // Guardar/resgatar de um cartão com limite garantido -- managed from the
  // card itself, so the extrato shows it without edit/delete.
  securedCardId?: string | null;
  loanId?: string | null;
  // Dinheiro guardado numa meta (goalId) ou entre as suas contas: transferência.
  transferKind?: "goal" | "accounts" | null;
  goalId?: string | null;
  linkKind?: LinkKind | null;
  accountId: string;
  paymentMethod: PaymentMethod | null;
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
  limit: string | null;
  limitUsed: string | null;
  // Ausente em resposta antiga em cache: trata como "open".
  status?: "open" | "paid" | "empty";
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
  // Net money moved into cartões com limite garantido this month -- left
  // the account without being a gasto (see getMonthlyTrendForUser).
  savedInCards?: number;
  // Quanto saiu emprestado pelos Empréstimos no mês -- mesmo tratamento.
  lentOut?: number;
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
  // Opcional: respostas em cache de uma versão antiga não têm.
  savedInSecuredCards?: number;
  owedOnCards?: number;
  loansSummary?: { outstanding: string; overdue: string; overdueCount: number };
  // "Eu devo": o que você pegou emprestado com pessoas e ainda vai devolver.
  owedSummary?: { outstanding: string; overdue: string; overdueCount: number };
  // Opcional: respostas em cache de uma versão antiga não têm.
  upcoming?: UpcomingItem[];
  trend6m: MonthlyTrendPoint[];
  alerts: AlertRow[];
  // Painel novo (opcional: cache de versão antiga não tem).
  heroDaily?: { day: string; balance: number }[];
  cardsSummary?: PainelCard[];
  goalsSummary?: PainelGoal[];
  savedInGoals?: number;
}

interface PainelCard {
  id: string;
  name: string;
  limit: string | null;
  limitUsed: string | null;
  limitType: "normal" | "secured";
  statementTotal: string;
  statementIsPaid: boolean;
  dueDate: string;
}

interface PainelGoal {
  id: string;
  name: string;
  currentAmount: string;
  targetAmount: string;
  deadline: string | null;
  itemsCount: number;
}

interface PainelData {
  heroDaily: { day: string; balance: number }[];
  trend6m: MonthlyTrendPoint[];
  cards: PainelCard[];
  goals: PainelGoal[];
  savedInGoals: number;
}

const EMPTY_PAINEL: PainelData = { heroDaily: [], trend6m: [], cards: [], goals: [], savedInGoals: 0 };

function painelFrom(data: DashboardResponse): PainelData {
  return {
    heroDaily: data.heroDaily ?? [],
    trend6m: data.trend6m ?? [],
    cards: data.cardsSummary ?? [],
    goals: data.goalsSummary ?? [],
    savedInGoals: data.savedInGoals ?? 0,
  };
}

interface UpcomingItem {
  id: string;
  kind: "card" | "debt" | "recurring" | "loan";
  direction: "pay" | "receive";
  title: string;
  detail: string;
  amount: number;
  dueDate: string;
  daysUntil: number;
  link: string;
  // Conta fixa sem valor certo: amount é a estimativa (0 = sem valor).
  amountMode?: "estimate" | "unknown";
}

interface AlertRow {
  id: string;
  severity: "info" | "warning" | "critical";
  message: string;
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

const MONTH_SHORT = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

function upcomingWhen(item: UpcomingItem): string {
  const d = item.daysUntil;
  if (item.direction === "receive") {
    if (d < 0) return `Atrasado ${-d} ${-d === 1 ? "dia" : "dias"}`;
    if (d === 0) return "Prazo hoje";
    return d === 1 ? "Prazo amanhã" : `Prazo em ${d} dias`;
  }
  if (d < 0) return `Venceu há ${-d} ${-d === 1 ? "dia" : "dias"}`;
  if (d === 0) return "Vence hoje";
  return d === 1 ? "Vence amanhã" : `Vence em ${d} dias`;
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const confirm = useConfirm();
  const { showToast } = useToast();
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
  const [painel, setPainel] = useState<PainelData>(() => readCache<PainelData>(monthKey("painel")) ?? EMPTY_PAINEL);
  const [recent, setRecent] = useState<TransactionListRow[]>(
    () => (readCache<TransactionListRow[]>(monthKey("recent")) ?? []).filter((row) => !isDeferredPending(`tx:${row.id}`))
  );
  const [, setDailyTrend] = useState<DailyTrendPoint[]>(() => readCache(monthKey("dailyTrend")) ?? []);
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
  const [, setGoalHighlight] = useState<GoalHighlight | null>(() =>
    readCache(staticKey("goalHighlight"))
  );
  const [, setNextInvoice] = useState<NextInvoice | null>(() => readCache(staticKey("nextInvoice")));
  const [savedInSecuredCards, setSavedInSecuredCards] = useState<number>(
    () => readCache(staticKey("savedInSecuredCards")) ?? 0
  );
  const [owedOnCards, setOwedOnCards] = useState<number>(() => readCache(staticKey("owedOnCards")) ?? 0);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>(() => readCache(staticKey("upcoming")) ?? []);
  const [owedToPeople, setOwedToPeople] = useState<number>(() => readCache(staticKey("owedToPeople")) ?? 0);
  const [loansOutstanding, setLoansOutstanding] = useState<number>(
    () => readCache(staticKey("loansOutstanding")) ?? 0
  );
  const [alerts, setAlerts] = useState<AlertRow[]>(() => readCache(monthKey("alerts")) ?? []);
  const [isLoading, setIsLoading] = useState(!group);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isUncatOpen, setIsUncatOpen] = useState(false);
  const nudges = useDashboardNudges(token, month, isImportOpen || isUncatOpen);
  // A notificação do Pluggy abre o Painel com ?importar=banco.
  useEffect(() => {
    const importar = searchParams.get("importar");
    if (importar !== "banco" && importar !== "extrato") return;
    setIsImportOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("importar");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const firstImport = useFirstImportPrompt(user?.id, token, month === currentMonthParam() && !isLoading && recent.length === 0);
  const [editingRecurringTx, setEditingRecurringTx] = useState<TransactionListRow | null>(null);
  // Rows playing their exit animation (see .is-leaving in index.css) before
  // they're actually dropped from `recent`.
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());

  // warmCacheOnly=true: a month not on screen (the user switched away mid-load)
  // -- writes the cache same as a real load, but never touches component
  // state (nothing should visibly change just because a background prefetch
  // finished).
  function applyDashboard(selectedMonth: string, data: DashboardResponse, warmCacheOnly: boolean) {
    const sKey = (name: string) => `dashboard:${name}:${user?.id ?? "anon"}`;
    const mKey = (name: string) => `dashboard:${name}:${selectedMonth}:${user?.id ?? "anon"}`;

    if (!warmCacheOnly) {
      setPainel(painelFrom(data));
      setGroup(data.group);
      setPersonalMonthTotals(data.personalMonthTotals);
      setPersonalPrevMonthTotals(data.personalPrevMonthTotals);
      setRecent(data.recent.filter((row) => !isDeferredPending(`tx:${row.id}`)));
      setDebts(data.debts);
      setSummary(data.summary);
      setJointSummary(data.jointSummary);
      setBalance(data.balance);
      setBudget(data.budget);
      setCategoryBudgets(data.categoryBudgets);
      setDailyTrend(data.dailyTrend);
      setGoalHighlight(data.goalHighlight);
      setNextInvoice(data.nextInvoice);
      setSavedInSecuredCards(data.savedInSecuredCards ?? 0);
      setOwedOnCards(data.owedOnCards ?? 0);
      setLoansOutstanding(Number(data.loansSummary?.outstanding ?? 0));
      setOwedToPeople(Number(data.owedSummary?.outstanding ?? 0));
      setUpcoming(data.upcoming ?? []);
      // ?? []: a response cached by an older build has no `alerts` at all.
      setAlerts(data.alerts ?? []);
    }

    writeCache(sKey("group"), data.group);
    writeCache(sKey("debts"), data.debts);
    writeCache(sKey("balance"), data.balance);
    writeCache(sKey("goalHighlight"), data.goalHighlight);
    writeCache(sKey("nextInvoice"), data.nextInvoice);
    writeCache(sKey("savedInSecuredCards"), data.savedInSecuredCards ?? 0);
    writeCache(sKey("owedOnCards"), data.owedOnCards ?? 0);
    writeCache(sKey("loansOutstanding"), Number(data.loansSummary?.outstanding ?? 0));
    writeCache(sKey("owedToPeople"), Number(data.owedSummary?.outstanding ?? 0));
    writeCache(sKey("upcoming"), data.upcoming ?? []);
    writeCache(mKey("personalMonthTotals"), data.personalMonthTotals);
    writeCache(mKey("personalPrevMonthTotals"), data.personalPrevMonthTotals);
    writeCache(mKey("recent"), data.recent);
    writeCache(mKey("summary"), data.summary);
    writeCache(mKey("jointSummary"), data.jointSummary);
    writeCache(mKey("budget"), data.budget);
    writeCache(mKey("categoryBudgets"), data.categoryBudgets);
    writeCache(mKey("dailyTrend"), data.dailyTrend);
    writeCache(mKey("alerts"), data.alerts ?? []);
    writeCache(mKey("painel"), painelFrom(data));
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
  async function load(selectedMonth: string, options?: { skipCache?: boolean; silent?: boolean }) {
    setError(null);
    const mKeyLocal = (name: string) => `dashboard:${name}:${selectedMonth}:${user?.id ?? "anon"}`;
    const cached = options?.skipCache ? null : readCache<DashboardResponse>(mKeyLocal("full"));

    if (cached) {
      // Already warmed (a previous visit, or the neighbor-month prefetch
      // below) -- paint instantly, no loading state at all, then quietly
      // refetch underneath to catch anything that changed since.
      applyDashboard(selectedMonth, cached, false);
    } else if (selectedMonth === activeMonthRef.current && !options?.silent) {
      setIsLoading(true);
    }

    try {
      // An optimistic write still in flight (a just-saved transaction) must
      // land first, or this GET could answer without it and erase what the
      // cache already showed.
      await whenWritesSettled();
      const data = await apiRequest<DashboardResponse>(`/dashboard?month=${selectedMonth}`, { token });
      // The user may have already switched to a different month while this
      // was in flight -- an abandoned month's response is discarded instead
      // of overwriting whatever's actually on screen now. Still worth
      // caching (see writeCache below via applyDashboard), just not painted.
      const isStillActive = selectedMonth === activeMonthRef.current;
      applyDashboard(selectedMonth, data, !isStillActive);

      // Sem pré-carregar os meses vizinhos: cada Painel custa centenas de
      // leituras do Firestore e o plano grátis tem 50 mil por dia -- com os
      // vizinhos, abrir o app lia 3 Painéis e o login começou a cair quando
      // o app foi divulgado. Trocar de mês agora busca na hora (e fica no
      // cache do navegador e do servidor depois disso).
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

  useEffect(() => {
    load(month);
  }, [token, month]);

  // An optimistic write that failed asks every screen to re-fetch the truth.
  useEffect(() => {
    const refetch = () => void load(month, { skipCache: true, silent: true });
    window.addEventListener(DATA_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refetch);
  }, [token, month]);

  // Instant local update for a removed row: the row plays its exit
  // animation, then leaves `recent`, and the month totals/category slice it
  // contributed to shrink right away. The server confirms in the background
  // (see the callers) -- nothing here waits on the network.
  function removeLocally(tx: TransactionListRow) {
    const amount = Number(tx.amount);
    const sign = tx.transactionType === "expense" ? "expense" : "income";
    const account = group?.accounts.find((a) => a.id === tx.accountId);
    setLeavingIds((current) => new Set(current).add(tx.id));
    window.setTimeout(() => {
      setRecent((current) => current.filter((row) => row.id !== tx.id));
      setLeavingIds((current) => {
        const next = new Set(current);
        next.delete(tx.id);
        return next;
      });
    }, 280);
    if (account?.type === "personal") {
      setPersonalMonthTotals((current) => ({ ...current, [sign]: Math.max(0, current[sign] - amount) }));
    }
    if (tx.transactionType === "expense") {
      setSummary((current) =>
        current
          ? {
              total: String(Math.max(0, Number(current.total) - amount)),
              byCategory: current.byCategory
                .map((row) =>
                  row.categoryId === tx.categoryId
                    ? { ...row, total: String(Math.max(0, Number(row.total) - amount)) }
                    : row
                )
                .filter((row) => Number(row.total) > 0),
            }
          : current
      );
    }
  }

  function restoreSnapshot(snapshot: {
    recent: TransactionListRow[];
    personalMonthTotals: MonthTotals;
    summary: SummaryResponse | null;
  }) {
    setRecent(snapshot.recent);
    setPersonalMonthTotals(snapshot.personalMonthTotals);
    setSummary(snapshot.summary);
  }

  // Delete with Desfazer: the request is only sent once the undo window
  // closes (see utils/deferredDelete.ts), so undoing never has to recreate
  // anything on the server.
  async function handleDelete(tx: TransactionListRow) {
    const confirmed = await confirm({
      title: `Excluir “${tx.description}”?`,
      body: `${formatCurrency(Number(tx.amount))} sai do extrato e dos totais do mês. Você ainda vai poder desfazer por alguns segundos.`,
      confirmLabel: "Excluir",
    });
    if (!confirmed) return;

    setError(null);
    const snapshot = { recent, personalMonthTotals, summary };
    const key = `tx:${tx.id}`;
    const targetMonth = month;
    removeLocally(tx);
    scheduleDeferred(key, async () => {
      try {
        await apiRequest(`/transactions/${tx.id}`, { method: "DELETE", token });
        await load(targetMonth, { skipCache: true, silent: true });
      } catch (err) {
        restoreSnapshot(snapshot);
        setError(err instanceof ApiError ? err.message : "Não foi possível excluir");
      }
    });
    showToast(`“${tx.description}” excluído`, {
      actionLabel: "Desfazer",
      onAction: () => {
        if (cancelDeferred(key)) restoreSnapshot(snapshot);
      },
    });
  }

  async function handleCancelRecurring(tx: TransactionListRow) {
    const confirmed = await confirm({
      title: `Cancelar a recorrência de “${tx.description}”?`,
      body: "Este lançamento e os dos próximos meses somem. Os que já aconteceram continuam no extrato.",
      confirmLabel: "Cancelar recorrência",
    });
    if (!confirmed) return;

    setError(null);
    const snapshot = { recent, personalMonthTotals, summary };
    removeLocally(tx);
    try {
      await apiRequest(`/transactions/${tx.id}/recurring`, { method: "DELETE", token });
      showToast("Recorrência cancelada");
      await load(month, { skipCache: true, silent: true });
    } catch (err) {
      restoreSnapshot(snapshot);
      setError(err instanceof ApiError ? err.message : "Não foi possível cancelar a recorrência");
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
  // opening/closing a modal (editingTx) doesn't redo it for no
  // reason -- none of those state changes affect this derived data.
  const income = personalMonthTotals.income;
  const expense = personalMonthTotals.expense;
  const savedInCards = personalMonthTotals.savedInCards ?? 0;
  const lentOut = personalMonthTotals.lentOut ?? 0;
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

  const uncategorizedShare = useMemo(() => {
    const rows = summary?.byCategory ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const uncategorized = Number(rows.find((row) => row.categoryId === null)?.total ?? 0);
    return total > 0 ? uncategorized / total : 0;
  }, [summary]);

  const categoryRows = useMemo(() => (summary?.byCategory ?? []).slice(0, 6), [summary]);
  const categoryMax = Math.max(1, ...categoryRows.map((row) => Number(row.total)));

  // "Seu dinheiro hoje": what's in the accounts this person can see (their
  // own + Nossa Conta -- the backend never sends anyone else's personal
  // balance) plus what's guardado in cartões com limite garantido.
  const visibleAccounts = group?.accounts ?? [];
  const accountsTotal = visibleAccounts.reduce((sum, account) => sum + account.balance, 0);
  // Guardado em metas também é seu (saiu da conta, ou já estava guardado).
  const moneyTotal = accountsTotal + savedInSecuredCards + painel.savedInGoals;


  // "Dá pra gastar por dia": only for the month actually being lived --
  // browsing a past month, "até o fim do mês" means nothing.
  const monthLeft = income - expense - savedInCards - lentOut;
  const dailyAllowance = useMemo(() => {
    if (month !== currentMonthParam()) return null;
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysLeft = daysInMonth - today.getDate() + 1;
    return monthLeft / daysLeft;
  }, [month, monthLeft]);

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
  // "Quem pagou o quê": quanto cada um pagou da conta conjunta no mês.
  const payers = orderedMembers.map((member, index) => ({
    ...member,
    total: jointSpentByUser(member.id),
    color: personColor(index),
  }));
  const lastDayOfMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();

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
      <div className="dashboard painel">
        <div className="painel-top">
          <div className="dashboard-greeting">
            <h1>Olá, {user?.displayName?.split(" ")[0]}</h1>
            <p className="card-subtitle">{monthLabel}</p>
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
          {firstImport.show && (
            <div className="card first-import">
              <span className="first-import-icon" aria-hidden="true">
                <Icon name="upload" />
              </span>
              <div className="first-import-text">
                <p className="card-title">Comece pelo extrato do banco</p>
                <p className="card-subtitle">
                  Mande o PDF do extrato (ou OFX/CSV) e o PAR. monta o mês de vocês em poucos minutos: você só diz o que é cada nome, e
                  ele lembra nas próximas vezes.
                </p>
                <div className="first-import-actions">
                  <button type="button" className="btn btn-primary" onClick={() => setIsImportOpen(true)}>
                    Importar extrato
                  </button>
                  <button type="button" className="btn btn-outline" onClick={firstImport.dismiss}>
                    Prefiro lançar na mão
                  </button>
                </div>
              </div>
            </div>
          )}
          {month === currentMonthParam() && user && <MonthCloseCard userId={user.id} token={token} />}

          {/* 1. O mês e o que precisa de atenção */}
          <div className="painel-grid painel-hero-row">
            <section className="card painel-hero" aria-label="Resumo do mês">
              <div className="painel-hero-top">
                <div>
                  {/* O número grande é o saldo do mês (entrou - saiu), não o
                      saldo acumulado das contas: quem lança só o salário todo
                      mês e não lança todo gasto veria o saldo crescer mês a mês
                      sem ter esse dinheiro de verdade. O saldo das contas fica
                      em "Onde está seu dinheiro". */}
                  <p className="painel-kicker">Saldo de {monthLongName(month)}</p>
                  <p className={`painel-big${monthLeft < 0 ? " negative" : ""}`}>
                    <AnimatedNumber value={monthLeft} />
                  </p>
                  {dailyAllowance !== null && dailyAllowance > 0 && (
                    <p className="hero-line">
                      Dá <strong>{formatCurrency(dailyAllowance)} por dia</strong> até o dia {lastDayOfMonth}.
                    </p>
                  )}
                  {dailyAllowance !== null && dailyAllowance <= 0 && income > 0 && (
                    <p className="hero-note">Você já gastou mais do que entrou este mês.</p>
                  )}
                </div>
                <FinancialHealthBadge monthlyIncome={income} monthlyExpense={expense} />
              </div>
              {painel.heroDaily.length > 0 && (
                <BalanceLineChart
                  points={painel.heroDaily}
                  todayDay={month === currentMonthParam() ? new Date().getDate() : null}
                />
              )}
              <div className="painel-kpis">
                <div className="painel-kpi">
                  <span className="painel-kpi-label">Entrou</span>
                  <span className="painel-kpi-value income-text">{formatCurrency(income)}</span>
                  {incomeDelta !== null && (
                    <span className={`stat-delta ${incomeDelta >= 0 ? "good" : "bad"}`}>
                      {incomeDelta >= 0 ? "+" : ""}
                      {Math.round(incomeDelta)}% vs {prevMonthName}
                    </span>
                  )}
                </div>
                <div className="painel-kpi">
                  <span className="painel-kpi-label">Saiu</span>
                  <span className="painel-kpi-value">{formatCurrency(expense)}</span>
                  {expenseDelta !== null && (
                    <span className={`stat-delta ${expenseDelta <= 0 ? "good" : "bad"}`}>
                      {expenseDelta >= 0 ? "+" : ""}
                      {Math.round(expenseDelta)}% vs {prevMonthName}
                    </span>
                  )}
                </div>
                <div className="painel-kpi">
                  <span className="painel-kpi-label">Guardado</span>
                  <span className="painel-kpi-value">{formatCurrency(savedInCards)}</span>
                  <span className="painel-kpi-sub">metas e cartão garantido</span>
                </div>
              </div>
              {(loansOutstanding > 0 || lentOut !== 0) && (
                <p className="hero-note">
                  {lentOut > 0
                    ? `${formatCurrency(lentOut)} emprestados este mês. Não é gasto, vai voltar pra você.`
                    : lentOut < 0
                    ? `${formatCurrency(-lentOut)} de empréstimos voltaram pra você este mês.`
                    : `${formatCurrency(loansOutstanding)} emprestados ainda vão voltar pra você.`}
                </p>
              )}
            </section>

            <section className="card painel-attention" aria-label="Precisa de atenção">
              <div className="section-header">
                <p className="card-title">Precisa de atenção</p>
                <Link to="/a-pagar" className="link">
                  Ver tudo
                </Link>
              </div>
              {month === currentMonthParam() && <BillRemindersCard onChanged={() => load(month, { skipCache: true, silent: true })} />}
              <ul className="painel-att-list">
                {nudges.bankTotal > 0 && (
                  <li>
                    <button type="button" className="painel-att-row" onClick={() => setIsImportOpen(true)}>
                      <span className="painel-att-badge" aria-hidden="true">
                        <Icon name="bank" />
                      </span>
                      <span className="painel-att-text">
                        <strong>
                          {nudges.bankTotal} {nudges.bankTotal === 1 ? "lançamento novo" : "lançamentos novos"} do banco
                        </strong>
                        <small>{nudges.banks.join(", ")} · revisar e importar</small>
                      </span>
                      <Icon name="chevron" className="icon painel-att-chevron" />
                    </button>
                  </li>
                )}
                {nudges.uncategorized > 0 && (
                  <li>
                    <button type="button" className="painel-att-row" onClick={() => setIsUncatOpen(true)}>
                      <span className="painel-att-badge warn" aria-hidden="true">
                        <Icon name="alert" />
                      </span>
                      <span className="painel-att-text">
                        <strong>
                          {nudges.uncategorized} {nudges.uncategorized === 1 ? "gasto sem categoria" : "gastos sem categoria"}
                        </strong>
                        <small>ficam fora dos relatórios · organizar</small>
                      </span>
                      <Icon name="chevron" className="icon painel-att-chevron" />
                    </button>
                  </li>
                )}
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <div className={`painel-att-row is-static severity-${alert.severity}`}>
                      <span className={`painel-att-badge${alert.severity === "critical" ? " bad" : " warn"}`} aria-hidden="true">
                        <Icon name="alert" />
                      </span>
                      <span className="painel-att-text">
                        <strong>{alert.message}</strong>
                      </span>
                    </div>
                  </li>
                ))}
                {upcoming.map((item) => (
                  <li key={item.id}>
                    <Link to={item.link} className={`painel-att-row${item.daysUntil < 0 ? " overdue" : ""}`}>
                      <span className={`painel-att-date${item.daysUntil < 0 ? " bad" : item.daysUntil <= 3 ? " warn" : ""}`}>
                        <strong>{item.dueDate.slice(8, 10)}</strong>
                        <small>{MONTH_SHORT[Number(item.dueDate.slice(5, 7)) - 1]}</small>
                      </span>
                      <span className="painel-att-text">
                        <strong className="text-truncate">{item.title}</strong>
                        <small>
                          {upcomingWhen(item)} · {item.detail}
                        </small>
                      </span>
                      <span className={`painel-att-amount ${item.direction}${item.amountMode ? ` ${item.amountMode}` : ""}`}>
                        {item.direction === "receive" ? "+" : ""}
                        {item.amountMode === "unknown" && item.amount === 0
                          ? "sem valor"
                          : `${item.amountMode ? "≈ " : ""}${formatCurrency(item.amount)}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {nudges.bankTotal === 0 && nudges.uncategorized === 0 && alerts.length === 0 && upcoming.length === 0 && (
                <p className="empty-state">Tudo em dia: nada vence nos próximos 7 dias.</p>
              )}
            </section>
          </div>

          {isUncatOpen && (
            <UncategorizedModal
              month={month}
              onClose={() => setIsUncatOpen(false)}
              onSaved={() => load(month, { skipCache: true, silent: true })}
            />
          )}
          {isImportOpen && (
            <ImportStatementModal onClose={() => setIsImportOpen(false)} onImported={() => load(month, { skipCache: true, silent: true })} />
          )}

          {/* 2. Dinheiro, cartões e orçamento */}
          <div className="painel-grid painel-3">
            <section className="card money-card" aria-label="Onde está seu dinheiro">
              <p className="card-title">Onde está seu dinheiro</p>
              <p className="money-card-total">{formatCurrency(moneyTotal)}</p>
              <ul className="money-card-list">
                {visibleAccounts.map((account) => (
                  <li key={account.id}>
                    <span>{account.name}</span>
                    <strong className={account.balance < 0 ? "danger-text" : ""}>{formatCurrency(account.balance)}</strong>
                  </li>
                ))}
                {painel.savedInGoals > 0 && (
                  <li>
                    <Link to="/goals" className="link">
                      Guardado em metas
                    </Link>
                    <strong>{formatCurrency(painel.savedInGoals)}</strong>
                  </li>
                )}
                {savedInSecuredCards > 0 && (
                  <li>
                    <Link to="/cards" className="link">
                      Guardado em cartões
                    </Link>
                    <strong>{formatCurrency(savedInSecuredCards)}</strong>
                  </li>
                )}
                {loansOutstanding > 0 && (
                  <li>
                    <Link to="/loans" className="link">
                      Vão te pagar
                    </Link>
                    <strong>{formatCurrency(loansOutstanding)}</strong>
                  </li>
                )}
                {owedToPeople > 0 && (
                  <li>
                    <Link to="/loans?lado=devo" className="link">
                      Você deve pra pessoas
                    </Link>
                    <strong className="owe-text">−{formatCurrency(owedToPeople)}</strong>
                  </li>
                )}
                {totalDebtRemaining > 0 && (
                  <li>
                    <Link to="/a-pagar?aba=dividas" className="link">
                      Dívidas em aberto
                    </Link>
                    <strong className="owe-text">−{formatCurrency(totalDebtRemaining)}</strong>
                  </li>
                )}
              </ul>
              {/* O outro lado: tira dívidas e faturas/parcelas de cartão em
                  aberto, pra o número não mostrar só o que vai entrar. */}
              {totalDebtRemaining + owedOnCards + owedToPeople > 0 && (
                <p className="money-card-future money-card-owed">
                  Depois de pagar o que deve:{" "}
                  <strong
                    className={
                      moneyTotal + loansOutstanding - totalDebtRemaining - owedOnCards - owedToPeople < 0 ? "danger-text" : ""
                    }
                  >
                    {formatCurrency(moneyTotal + loansOutstanding - totalDebtRemaining - owedOnCards - owedToPeople)}
                  </strong>
                </p>
              )}
              <p className="card-subtitle">Saldo de tudo o que foi lançado até hoje, não só deste mês.</p>
            </section>

            <section className="card painel-cards" aria-label="Cartões">
              <div className="section-header">
                <p className="card-title">Cartões</p>
                <Link to="/cards" className="link">
                  Ver cartões
                </Link>
              </div>
              {painel.cards.length === 0 ? (
                <p className="empty-state">
                  Nenhum cartão ainda.{" "}
                  <Link to="/cards" className="link">
                    Cadastrar
                  </Link>
                </p>
              ) : (
                <ul className="painel-card-list">
                  {painel.cards.map((card) => {
                    const limit = card.limit !== null ? Number(card.limit) : null;
                    const used = card.limitUsed !== null ? Number(card.limitUsed) : null;
                    const percent = limit && used !== null ? (used / limit) * 100 : 0;
                    const tone = percent >= 100 ? "over" : percent >= 80 ? "warning" : "ok";
                    return (
                      <li key={card.id}>
                        <div className="painel-card-top">
                          <strong>{card.name}</strong>
                          {limit !== null && used !== null ? (
                            <span className={`painel-card-state ${tone}`}>{Math.round(percent)}% do limite</span>
                          ) : (
                            <Link to="/cards" className="link">
                              Cadastrar limite
                            </Link>
                          )}
                        </div>
                        {limit !== null && used !== null && (
                          <div className="progress-track card-limit-track" role="img" aria-label={`${card.name}: ${Math.round(percent)}% do limite usado`}>
                            <div className={`progress-fill ${tone === "ok" ? "" : tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
                          </div>
                        )}
                        <div className="painel-card-sub">
                          {limit !== null && used !== null ? (
                            <>
                              <span>
                                {formatCurrency(used)} de {formatCurrency(limit)}
                              </span>
                              <span>{used >= limit ? `passou ${formatCurrency(used - limit)}` : `sobram ${formatCurrency(limit - used)}`}</span>
                            </>
                          ) : (
                            <span>
                              {card.statementIsPaid
                                ? "Fatura paga"
                                : Number(card.statementTotal) > 0
                                ? `Fatura de ${formatCurrency(Number(card.statementTotal))} · ${dueLabel(daysUntil(card.dueDate))}`
                                : "Sem compras na fatura atual"}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={`card budget-card${cap ? "" : " is-empty"}`} aria-label="Orçamento do mês">
              <div className="budget-header">
                <p className="card-title">Orçamento do mês</p>
                <Link to="/account" className="link">
                  {cap ? "Ajustar" : "Definir teto"}
                </Link>
              </div>
              {cap ? (
                <div className="budget-ring-row">
                  <CircularProgress
                    percent={budgetPercent}
                    size={92}
                    strokeWidth={9}
                    trackColor="var(--tan-track)"
                    color={
                      budgetSeverity === "over"
                        ? "var(--status-critical)"
                        : budgetSeverity === "warning"
                          ? "var(--status-warning)"
                          : "var(--color-primary)"
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
                        ? "Passou do orçamento"
                        : budgetSeverity === "warning"
                          ? "Perto do limite"
                          : "Tudo sob controle"}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="empty-state">Defina um teto mensal na Conta pra acompanhar aqui.</p>
              )}
            </section>
          </div>

          {/* 3. Pra onde foi o dinheiro */}
          <div className="painel-grid painel-2">
            <section className="card" aria-label="Pra onde foi o dinheiro">
              <div className="section-header">
                <p className="card-title">Pra onde foi o dinheiro</p>
                <Link to="/reports" className="link">
                  Relatório
                </Link>
              </div>
              {uncategorizedShare >= 0.5 && (
                <p className="report-insight">
                  <Icon name="spark" />
                  <span>
                    {Math.round(uncategorizedShare * 100)}% dos gastos estão sem categoria.{" "}
                    <button type="button" className="link-button" onClick={() => setIsUncatOpen(true)}>
                      Organizar
                    </button>{" "}
                    pra ver pra onde o dinheiro vai.
                  </span>
                </p>
              )}
              {categoryRows.length === 0 ? (
                <p className="empty-state">Nenhuma despesa neste mês.</p>
              ) : (
                <ul className="painel-cat-list">
                  {categoryRows.map((row) => {
                    const value = Number(row.total);
                    const categoryCap = row.categoryId ? categoryCapById.get(row.categoryId) : undefined;
                    const capPercent = categoryCap ? (value / categoryCap) * 100 : 0;
                    const capTone = capPercent >= 100 ? "over" : capPercent >= 80 ? "warning" : "";
                    return (
                      <li key={row.categoryId ?? "none"}>
                        <span className="painel-cat-name">{row.categoryName ?? "Sem categoria"}</span>
                        <span className="painel-cat-track" aria-hidden="true">
                          <span style={{ width: `${Math.max(2, (value / categoryMax) * 100)}%` }} />
                        </span>
                        <span className="painel-cat-value">{formatCurrency(value)}</span>
                        {categoryCap !== undefined && (
                          <span className={`painel-cat-cap ${capTone}`}>
                            {Math.round(capPercent)}% do teto de {formatCurrency(categoryCap)}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
            <section className="card" aria-label="Entrou e saiu nos últimos 6 meses">
              <div className="section-header">
                <p className="card-title">Entrou e saiu</p>
                <span className="card-subtitle">últimos 6 meses</span>
              </div>
              <div className="painel-legend">
                <span>
                  <i style={{ background: "var(--series-1)" }} />
                  Entrou
                </span>
                <span>
                  <i style={{ background: "var(--series-2)" }} />
                  Saiu
                </span>
              </div>
              {painel.trend6m.length > 0 ? (
                <InOutMonthsChart months={painel.trend6m.map((point) => ({ month: point.month, income: point.income, expense: point.expense }))} />
              ) : (
                <p className="empty-state">Sem lançamentos nos últimos meses.</p>
              )}
            </section>
          </div>

          {/* 4. Metas e o extrato */}
          <div className="painel-grid painel-2">
            <section className="card" aria-label="Metas">
              <div className="section-header">
                <p className="card-title">Metas</p>
                <Link to="/goals" className="link">
                  Ver metas
                </Link>
              </div>
              {painel.goals.length === 0 ? (
                <p className="empty-state">
                  Nenhuma meta em andamento.{" "}
                  <Link to="/goals" className="link">
                    Criar uma
                  </Link>
                </p>
              ) : (
                <ul className="painel-goal-list">
                  {painel.goals.map((goal) => {
                    const current = Number(goal.currentAmount);
                    const target = Number(goal.targetAmount);
                    const monthly = minimumMonthlySaving(target, current, goal.deadline);
                    return (
                      <li key={goal.id}>
                        <Link to="/goals" className="painel-goal">
                          <span className="painel-goal-icon">{initialOf(goal.name)}</span>
                          <span className="painel-goal-body">
                            <span className="painel-goal-top">
                              <strong>{goal.name}</strong>
                              <span>
                                {formatCurrency(current)} de {formatCurrency(target)}
                              </span>
                            </span>
                            <span className="progress-track thin">
                              <span className="progress-fill" style={{ width: `${target > 0 ? Math.min(100, (current / target) * 100) : 0}%` }} />
                            </span>
                            {monthly && (
                              <small>
                                Guarde {formatCurrency(monthly.perMonth)}/mês pra chegar no prazo
                                {goal.itemsCount > 0 ? ` · ${goal.itemsCount} submetas` : ""}
                              </small>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card" aria-label="Últimos lançamentos">
              <div className="section-header">
                <p className="card-title">Últimos lançamentos</p>
                <Link to="/reports" className="link">
                  Extrato
                </Link>
              </div>
              {recent.length === 0 ? (
                <p className="empty-state">Nenhum lançamento neste mês.</p>
              ) : (
                <ul className="transaction-list">
                  {recentGroups.map((dayGroup) => (
                    <Fragment key={dayGroup.label}>
                      <li className="date-group-header">{dayGroup.label}</li>
                      {dayGroup.items.map((tx) => (
                        <li key={tx.id} className={`transaction-row${leavingIds.has(tx.id) ? " is-leaving" : ""}`}>
                          <span className="transaction-icon">{initialOf(tx.categoryName ?? tx.description)}</span>
                          <div className="transaction-info">
                            <span className="transaction-desc">
                              <span className="text-truncate">{tx.description}</span>
                              {tx.recurringGroupId && (
                                <span className="badge recurring-badge" title="Recorrente">
                                  Mensal
                                </span>
                              )}
                            </span>
                            <span className="transaction-meta">
                              <span className="text-truncate">
                                {tx.categoryName ?? "Sem categoria"}
                                {tx.paymentMethod && ` · ${paymentMethodLabel(tx.paymentMethod)}`}
                              </span>
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
                          {!tx.securedCardId && !tx.loanId && !tx.goalId && (
                            <div className="transaction-row-actions">
                              <button type="button" className="btn-icon" title="Editar" onClick={() => setEditingTx(tx)}>
                                <Icon name="pencil" />
                              </button>
                              <RowActionsMenu
                                actions={[
                                  ...(tx.recurringGroupId
                                    ? [
                                        {
                                          key: "edit-recurring",
                                          label: "Editar valor da recorrência",
                                          icon: "pencil" as const,
                                          onClick: () => setEditingRecurringTx(tx),
                                        },
                                        {
                                          key: "cancel-recurring",
                                          label: "Cancelar recorrência",
                                          icon: "repeatOff" as const,
                                          onClick: () => handleCancelRecurring(tx),
                                        },
                                      ]
                                    : []),
                                  {
                                    key: "repeat",
                                    label: "Repetir (lançar de novo hoje)",
                                    icon: "repeat" as const,
                                    onClick: () => navigate(repeatHref(tx)),
                                  },
                                  ...(isLinkedTransaction(tx)
                                    ? []
                                    : [
                                        {
                                          key: "delete",
                                          label: "Excluir",
                                          icon: "trash" as const,
                                          danger: true,
                                          onClick: () => handleDelete(tx),
                                        },
                                      ]),
                                ]}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </Fragment>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Casal: quem pagou o quê da conta conjunta (detalhe na tela Par). */}
          {jointAccount && orderedMembers.length > 1 && (
            <SplitSummary
              payers={payers}
              accountName={jointAccount.name}
              currentUserId={user?.id}
              memberName={memberName}
              settlements={balance?.balances}
              settleHref="/par"
            />
          )}

          {activeDebts.length > 0 && (
            <section className="card" aria-label="Dívidas">
              <div className="section-header">
                <p className="card-title">Dívidas</p>
                <Link to="/a-pagar?aba=dividas" className="link">
                  Ver tudo
                </Link>
              </div>
              <ul className="category-breakdown">
                {activeDebts.slice(0, 3).map((debt) => {
                  const percent = Math.round((debt.paidAmount / Number(debt.totalAmount)) * 100);
                  return (
                    <li key={debt.id}>
                      <div className="category-row-header">
                        <span>{debt.name}</span>
                        <span className="value">{formatCurrency(debt.remainingAmount)}</span>
                      </div>
                      <div className="progress-track thin">
                        <div className="progress-fill" style={{ width: `${percent}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
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

// Conta nova (nenhum lançamento, nunca): o Painel abre sugerindo trazer o
// extrato, que é o jeito mais rápido de o app ter os números do casal. Só
// consulta o servidor quando o mês atual está vazio, e "Prefiro lançar na
// mão" esconde de vez (por pessoa, neste aparelho).
function useFirstImportPrompt(userId: string | undefined, token: string | null, monthIsEmpty: boolean) {
  const key = userId ? `par:first-import-dismissed:${userId}` : null;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return key ? localStorage.getItem(key) === "1" : true;
    } catch {
      return false;
    }
  });
  const [neverLogged, setNeverLogged] = useState(false);

  useEffect(() => {
    if (!monthIsEmpty || dismissed || !token) {
      setNeverLogged(false);
      return;
    }
    let active = true;
    apiRequest<unknown[]>("/transactions?limit=1", { token })
      .then((rows) => active && setNeverLogged(rows.length === 0))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [monthIsEmpty, dismissed, token]);

  return {
    show: monthIsEmpty && neverLogged && !dismissed,
    dismiss: () => {
      setDismissed(true);
      try {
        if (key) localStorage.setItem(key, "1");
      } catch {
        // só conveniência
      }
    },
  };
}

// Avisos curtos no topo do Painel: lançamentos que o banco conectado mandou
// e ainda não foram importados, e gastos do mês sem categoria. Recarrega
// quando uma das janelas (importar / organizar) fecha.
function useDashboardNudges(token: string | null, month: string, paused: boolean) {
  const [bank, setBank] = useState<{ total: number; banks: string[] }>({ total: 0, banks: [] });
  const [uncategorized, setUncategorized] = useState(0);
  useEffect(() => {
    if (!token || paused) return;
    apiRequest<{ total: number; banks: string[] }>("/open-finance/pending", { token })
      .then(setBank)
      .catch(() => setBank({ total: 0, banks: [] }));
    apiRequest<{ count: number }>(`/transactions/uncategorized?month=${month}`, { token })
      .then((res) => setUncategorized(res.count))
      .catch(() => setUncategorized(0));
  }, [token, month, paused]);
  return { bankTotal: bank.total, banks: bank.banks, uncategorized };
}
