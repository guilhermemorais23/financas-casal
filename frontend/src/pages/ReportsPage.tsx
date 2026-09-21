import { Fragment, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiDownload, apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryPieChart } from "../components/CategoryPieChart";
import { EditRecurringModal } from "../components/EditRecurringModal";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { Icon } from "../components/Icon";
import { MonthPicker } from "../components/MonthPicker";
import { RowActionsMenu } from "../components/RowActionsMenu";
import { SplitStatusPill } from "../components/SplitStatusPill";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { currentMonthParam, formatCurrency, groupByDay, monthLongName } from "../utils/format";
import { cancelDeferred, isDeferredPending, scheduleDeferred } from "../utils/deferredDelete";
import { readCache, writeCache } from "../utils/pageCache";
import { DATA_CHANGED_EVENT, whenWritesSettled } from "../utils/pendingWrites";
import { PAYMENT_METHOD_OPTIONS, paymentMethodLabel, type PaymentMethod } from "../utils/paymentMethod";

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

interface MonthlyTotalPoint {
  month: string;
  income: string;
  expense: string;
}

interface YearlySummaryResponse {
  year: number;
  months: MonthlyTotalPoint[];
  totalIncome: string;
  totalExpense: string;
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
  recurringGroupId: string | null;
  splitType: "none" | "equal";
  isSettled: boolean;
  accountId: string;
  accountType: "personal" | "joint";
  paymentMethod: PaymentMethod | null;
  payerId: string;
}

type GroupMode = "day" | "category" | "payment";

interface TxGroup {
  key: string;
  label: string;
  icon: string | null;
  items: TransactionListRow[];
  expense: number;
  income: number;
}

function makeGroup(key: string, label: string, icon: string | null, items: TransactionListRow[]): TxGroup {
  let expense = 0;
  let income = 0;
  for (const tx of items) {
    if (tx.transactionType === "income") income += Number(tx.amount);
    else expense += Number(tx.amount);
  }
  return { key, label, icon, items, expense, income };
}

// One collapsible section per day / category / forma de pagamento, each with
// its own count and subtotal -- a month with hundreds of lançamentos reads as
// a handful of headers first, details on demand.
function buildGroups(rows: TransactionListRow[], mode: GroupMode): TxGroup[] {
  if (mode === "day") {
    return groupByDay(rows).map((group) => makeGroup(group.label, group.label, null, group.items));
  }
  const buckets = new Map<string, TransactionListRow[]>();
  for (const tx of rows) {
    const key = mode === "category" ? (tx.categoryId ?? "none") : (tx.paymentMethod ?? "none");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(tx);
    else buckets.set(key, [tx]);
  }
  return [...buckets.entries()]
    .map(([key, items]) => {
      if (mode === "category") {
        return makeGroup(key, items[0].categoryName ?? "Sem categoria", items[0].categoryEmoji ?? "✨", items);
      }
      const option = PAYMENT_METHOD_OPTIONS.find((o) => o.value === key);
      return makeGroup(key, option?.label ?? "Não informado", option?.icon ?? "❔", items);
    })
    .sort((a, b) => b.expense - a.expense || b.income - a.income);
}

export function ReportsPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
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
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [editingRecurringTx, setEditingRecurringTx] = useState<TransactionListRow | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupBy, setGroupBy] = useState<GroupMode>("day");
  const [typeFilter, setTypeFilter] = useState<"expense" | "income" | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentMethod | "none" | null>(null);
  const [accountFilter, setAccountFilter] = useState<"personal" | "joint" | null>(null);
  // Per-group open/closed the user toggled by hand; anything not in here
  // falls back to the default in isGroupOpen below.
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const [showYearly, setShowYearly] = useState(false);

  const [selectedYear, setSelectedYear] = useState(() => Number(month.slice(0, 4)));
  const [yearSummary, setYearSummary] = useState<YearlySummaryResponse | null>(() =>
    readCache(`reports:year:${selectedYear}:${user?.id ?? "anon"}`)
  );

  useEffect(() => {
    // Collapsed by default -- don't fetch a whole year until it's opened.
    if (!showYearly) return;
    const yearCacheKey = `reports:year:${selectedYear}:${user?.id ?? "anon"}`;
    const cached = readCache<YearlySummaryResponse>(yearCacheKey);
    if (cached) setYearSummary(cached);
    apiRequest<YearlySummaryResponse>(`/transactions/summary/year?year=${selectedYear}&scope=visible`, { token })
      .then((res) => {
        setYearSummary(res);
        writeCache(yearCacheKey, res);
      })
      .catch(() => {
        // Best-effort widget -- a failed fetch just leaves whatever was
        // there (cached or null) instead of showing an error banner.
      });
  }, [token, selectedYear, showYearly]);

  async function load(selectedMonth: string, options?: { silent?: boolean }) {
    if (!options?.silent) setIsLoading(true);
    const cached = readCache<SummaryResponse>(cacheKey("summary", selectedMonth));
    if (cached) {
      setSummary(cached);
      setTransactions(readCache(cacheKey("transactions", selectedMonth)));
    }
    try {
      await whenWritesSettled();
      const [summaryRes, txRes] = await Promise.all([
        apiRequest<SummaryResponse>(`/transactions/summary?month=${selectedMonth}&scope=visible`, { token }),
        apiRequest<TransactionListRow[]>(`/transactions?limit=500&month=${selectedMonth}`, { token }),
      ]);
      setSummary(summaryRes);
      setTransactions(txRes.filter((row) => !isDeferredPending(`tx:${row.id}`)));
      writeCache(cacheKey("summary", selectedMonth), summaryRes);
      writeCache(cacheKey("transactions", selectedMonth), txRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os relatórios");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const refetch = () => void load(month, { silent: true });
    window.addEventListener(DATA_CHANGED_EVENT, refetch);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, refetch);
  }, [token, month]);

  useEffect(() => {
    load(month);
    setSelectedCategoryId(null);
    setGroupOverrides({});
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

  // Same endpoint, just without ?month= -- exportTransactionsForUser
  // already treats a missing month as "no date filter" (up to 10k rows,
  // far above what any group would realistically have).
  async function handleExportAll() {
    setIsExporting(true);
    setError(null);
    try {
      await apiDownload("/transactions/export", token, "par-transacoes-tudo.csv");
      showToast("CSV baixado");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível exportar");
    } finally {
      setIsExporting(false);
    }
  }

  // Instant local update for a removed row (exit animation, then out of the
  // list, and the category slice shrinks) -- the server confirms in the
  // background, nothing here waits on the network.
  function removeLocally(tx: TransactionListRow) {
    const amount = Number(tx.amount);
    setLeavingIds((current) => new Set(current).add(tx.id));
    window.setTimeout(() => {
      setTransactions((current) => current?.filter((row) => row.id !== tx.id) ?? current);
      setLeavingIds((current) => {
        const next = new Set(current);
        next.delete(tx.id);
        return next;
      });
    }, 280);
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

  // Delete with Desfazer: the request only goes out once the undo window
  // closes (utils/deferredDelete.ts), so undoing never recreates anything.
  async function handleDelete(tx: TransactionListRow) {
    const confirmed = await confirm({
      title: `Excluir “${tx.description}”?`,
      body: `${formatCurrency(Number(tx.amount))} sai do extrato e dos totais do mês. Você ainda vai poder desfazer por alguns segundos.`,
      confirmLabel: "Excluir",
    });
    if (!confirmed) return;

    setError(null);
    const snapshot = { transactions, summary };
    const key = `tx:${tx.id}`;
    const targetMonth = month;
    removeLocally(tx);
    scheduleDeferred(key, async () => {
      try {
        await apiRequest(`/transactions/${tx.id}`, { method: "DELETE", token });
        await load(targetMonth, { silent: true });
      } catch (err) {
        setTransactions(snapshot.transactions);
        setSummary(snapshot.summary);
        setError(err instanceof ApiError ? err.message : "Não foi possível excluir");
      }
    });
    showToast(`“${tx.description}” excluído`, {
      actionLabel: "Desfazer",
      onAction: () => {
        if (cancelDeferred(key)) {
          setTransactions(snapshot.transactions);
          setSummary(snapshot.summary);
        }
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
    const snapshot = { transactions, summary };
    removeLocally(tx);
    try {
      await apiRequest(`/transactions/${tx.id}/recurring`, { method: "DELETE", token });
      showToast("Recorrência cancelada");
      await load(month, { silent: true });
    } catch (err) {
      setTransactions(snapshot.transactions);
      setSummary(snapshot.summary);
      setError(err instanceof ApiError ? err.message : "Não foi possível cancelar a recorrência");
    }
  }

  // Local list update SplitStatusPill drives directly (optimistic flip,
  // reverted again if its request fails) -- see that component for the
  // actual settle/reopen calls.
  function setTransactionSettled(transactionId: string, nextSettled: boolean) {
    setTransactions(
      (current) => current?.map((row) => (row.id === transactionId ? { ...row, isSettled: nextSettled } : row)) ?? current
    );
  }

  const visibleTransactions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return (transactions ?? []).filter((tx) => {
      if (selectedCategoryId) {
        const matchesCategory = selectedCategoryId === "none" ? tx.categoryId === null : tx.categoryId === selectedCategoryId;
        if (!matchesCategory) return false;
      }
      if (typeFilter && tx.transactionType !== typeFilter) return false;
      if (paymentFilter && (tx.paymentMethod ?? "none") !== paymentFilter) return false;
      if (accountFilter && tx.accountType !== accountFilter) return false;
      if (normalizedQuery && !tx.description.toLowerCase().includes(normalizedQuery)) return false;
      return true;
    });
  }, [transactions, selectedCategoryId, searchQuery, typeFilter, paymentFilter, accountFilter]);
  const hasActiveFilter =
    selectedCategoryId !== null ||
    typeFilter !== null ||
    paymentFilter !== null ||
    accountFilter !== null ||
    searchQuery.trim() !== "";
  const groups = useMemo(() => buildGroups(visibleTransactions, groupBy), [visibleTransactions, groupBy]);
  const visibleTotals = useMemo(() => makeGroup("all", "", null, visibleTransactions), [visibleTransactions]);
  // Default: with a filter on, results are few and the point is to read them
  // -- everything open. Otherwise only the 3 most recent days start open and
  // category/payment views start collapsed so the subtotals are what you see.
  function isGroupOpen(group: TxGroup, index: number): boolean {
    const override = groupOverrides[`${groupBy}:${group.key}`];
    if (override !== undefined) return override;
    return hasActiveFilter || (groupBy === "day" && index < 3);
  }
  function toggleGroup(group: TxGroup, index: number) {
    setGroupOverrides((current) => ({ ...current, [`${groupBy}:${group.key}`]: !isGroupOpen(group, index) }));
  }
  function setAllGroups(open: boolean) {
    setGroupOverrides(Object.fromEntries(groups.map((group) => [`${groupBy}:${group.key}`, open])));
  }
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

  function renderTransactionRow(tx: TransactionListRow) {
    return (
        <li key={tx.id} className={`transaction-row${leavingIds.has(tx.id) ? " is-leaving" : ""}`}>
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
              {tx.recurringGroupId && <span className="badge recurring-badge" title="Recorrente">🔁</span>}
            </span>
            <span className="transaction-meta">
              {tx.categoryName ?? "Sem categoria"}
              {tx.paymentMethod && ` · ${paymentMethodLabel(tx.paymentMethod)}`}
              {tx.splitType === "equal" && (
                <SplitStatusPill
                  token={token}
                  transactionId={tx.id}
                  totalAmount={Number(tx.amount)}
                  isSettled={tx.isSettled}
                  onOptimisticChange={(next) => setTransactionSettled(tx.id, next)}
                  onSettled={() => load(month)}
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
                  key: "delete",
                  label: "Excluir",
                  icon: "trash" as const,
                  danger: true,
                  onClick: () => handleDelete(tx),
                },
              ]}
            />
          </div>
        </li>
    );
  }

  return (
    <AppLayout>
      <div className="page-stack">
        {isLoading && <p className="refresh-note">Atualizando...</p>}
        <div className="section-header">
          <h1>Relatórios</h1>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <MonthPicker value={month} onChange={setMonth} />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleExport}
              disabled={isExporting || !transactions || transactions.length === 0}
              title="Baixar os lançamentos deste mês em CSV"
            >
              {isExporting ? "Baixando..." : "⬇ CSV"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleExportAll}
              disabled={isExporting}
              title="Baixar todos os lançamentos de todos os meses em CSV"
            >
              ⬇ Tudo
            </button>
          </div>
        </div>

        <div className="stat-row wrap">
          <div className="stat-box tone-good">
            <p className="label">Entrada</p>
            <p className="value-sm income-text">{formatCurrency(incomeTotal)}</p>
          </div>
          <div className="stat-box tone-warm">
            <p className="label">Saída</p>
            <p className="value-sm">{formatCurrency(expenseTotal)}</p>
          </div>
          <div className="stat-box">
            <p className="label">Saldo do mês</p>
            <p className={`value-sm${incomeTotal - expenseTotal >= 0 ? " income-text" : ""}`}>
              {formatCurrency(incomeTotal - expenseTotal)}
            </p>
            <p className="stat-delta neutral">conta pessoal + conjunta</p>
          </div>
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
            {hasActiveFilter && (
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setSelectedCategoryId(null);
                  setTypeFilter(null);
                  setPaymentFilter(null);
                  setAccountFilter(null);
                  setSearchQuery("");
                }}
              >
                × Limpar filtros
              </button>
            )}
          </div>
          {transactions && transactions.length > 0 && (
            <div className="report-toolbar">
              <input
                type="search"
                placeholder="Buscar por descrição..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar lançamentos por descrição"
              />
              <div className="segmented">
                {(
                  [
                    ["day", "Por dia"],
                    ["category", "Por categoria"],
                    ["payment", "Por pagamento"],
                  ] as [GroupMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`segmented-option${groupBy === mode ? " active" : ""}`}
                    onClick={() => {
                      setGroupBy(mode);
                      setGroupOverrides({});
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chip-row">
                <button
                  type="button"
                  className={`filter-chip${typeFilter === "expense" ? " active" : ""}`}
                  onClick={() => setTypeFilter((c) => (c === "expense" ? null : "expense"))}
                >
                  Despesas
                </button>
                <button
                  type="button"
                  className={`filter-chip${typeFilter === "income" ? " active" : ""}`}
                  onClick={() => setTypeFilter((c) => (c === "income" ? null : "income"))}
                >
                  Receitas
                </button>
                <span className="filter-chip-sep" aria-hidden="true" />
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`filter-chip${paymentFilter === option.value ? " active" : ""}`}
                    onClick={() => setPaymentFilter((c) => (c === option.value ? null : option.value))}
                  >
                    {option.icon} {option.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`filter-chip${paymentFilter === "none" ? " active" : ""}`}
                  onClick={() => setPaymentFilter((c) => (c === "none" ? null : "none"))}
                >
                  Sem forma informada
                </button>
                <span className="filter-chip-sep" aria-hidden="true" />
                <button
                  type="button"
                  className={`filter-chip${accountFilter === "personal" ? " active" : ""}`}
                  onClick={() => setAccountFilter((c) => (c === "personal" ? null : "personal"))}
                >
                  Pessoal
                </button>
                <button
                  type="button"
                  className={`filter-chip${accountFilter === "joint" ? " active" : ""}`}
                  onClick={() => setAccountFilter((c) => (c === "joint" ? null : "joint"))}
                >
                  Conjunta
                </button>
              </div>
              <div className="report-summary-line">
                <span>
                  {visibleTotals.items.length} lançamento{visibleTotals.items.length === 1 ? "" : "s"}
                  {visibleTotals.expense > 0 && <> · saiu <strong>{formatCurrency(visibleTotals.expense)}</strong></>}
                  {visibleTotals.income > 0 && (
                    <> · entrou <strong className="income-text">{formatCurrency(visibleTotals.income)}</strong></>
                  )}
                </span>
                {groups.length > 1 && (
                  <span className="report-summary-actions">
                    <button type="button" className="link-button" onClick={() => setAllGroups(true)}>
                      Expandir tudo
                    </button>
                    <button type="button" className="link-button" onClick={() => setAllGroups(false)}>
                      Recolher tudo
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {transactions && transactions.length > 0 && visibleTransactions.length === 0 && (
            <p className="empty-state">Nada encontrado com esses filtros.</p>
          )}
          {transactions && transactions.length === 0 && (
            <p className="empty-state">Nenhuma transação neste mês.</p>
          )}
          <ul className="transaction-list">
            {groups.map((group, index) => {
              const open = isGroupOpen(group, index);
              return (
                <Fragment key={`${groupBy}:${group.key}`}>
                  <li className="report-group">
                    <button
                      type="button"
                      className="report-group-header"
                      onClick={() => toggleGroup(group, index)}
                      aria-expanded={open}
                    >
                      <span className="report-group-chevron">{open ? "▾" : "▸"}</span>
                      <span className="report-group-label">
                        {group.icon && `${group.icon} `}
                        {group.label}
                      </span>
                      <span className="report-group-count">{group.items.length}</span>
                      <span className="report-group-total">
                        {group.expense > 0 && <span>−{formatCurrency(group.expense)}</span>}
                        {group.income > 0 && <span className="income-text">+{formatCurrency(group.income)}</span>}
                      </span>
                    </button>
                  </li>
                  {open && group.items.map((tx) => renderTransactionRow(tx))}
                </Fragment>
              );
            })}
          </ul>
        </div>

        <div className="card">
          <div className="section-header">
            <button
              type="button"
              className="report-group-header report-card-toggle"
              onClick={() => setShowYearly((open) => !open)}
              aria-expanded={showYearly}
            >
              <span className="report-group-chevron">{showYearly ? "▾" : "▸"}</span>
              <span className="card-title">Visão anual</span>
            </button>
            {showYearly && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button type="button" className="btn-icon" onClick={() => setSelectedYear((y) => y - 1)} title="Ano anterior">
                  ◀
                </button>
                <strong>{selectedYear}</strong>
                <button type="button" className="btn-icon" onClick={() => setSelectedYear((y) => y + 1)} title="Próximo ano">
                  ▶
                </button>
              </div>
            )}
          </div>
          {showYearly && yearSummary && (
            <>
              <p className="card-subtitle">
                Total do ano: <strong className="income-text">{formatCurrency(Number(yearSummary.totalIncome))}</strong>{" "}
                de entrada · <strong>{formatCurrency(Number(yearSummary.totalExpense))}</strong> de saída
              </p>
              <ul className="yearly-summary-list">
                {yearSummary.months.map((point) => {
                  const maxValue = Math.max(
                    ...yearSummary.months.flatMap((m) => [Number(m.income), Number(m.expense)]),
                    1
                  );
                  return (
                    <li key={point.month} className="yearly-summary-row">
                      <span className="yearly-summary-month">{monthLongName(point.month).slice(0, 3)}</span>
                      <div className="yearly-summary-bars">
                        <div
                          className="yearly-summary-bar income"
                          style={{ width: `${(Number(point.income) / maxValue) * 100}%` }}
                        />
                        <div
                          className="yearly-summary-bar expense"
                          style={{ width: `${(Number(point.expense) / maxValue) * 100}%` }}
                        />
                      </div>
                      <span className="yearly-summary-values">
                        <span className="income-text">{formatCurrency(Number(point.income))}</span>
                        {" / "}
                        {formatCurrency(Number(point.expense))}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>

      {editingTx && (
        <EditTransactionModal
          transaction={editingTx}
          onClose={() => setEditingTx(null)}
          onSaved={() => load(month)}
        />
      )}
      {editingRecurringTx && (
        <EditRecurringModal
          transaction={editingRecurringTx}
          onClose={() => setEditingRecurringTx(null)}
          onSaved={() => load(month)}
        />
      )}
    </AppLayout>
  );
}
