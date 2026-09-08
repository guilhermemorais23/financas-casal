import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryPieChart } from "../components/CategoryPieChart";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { SplitStatusPill } from "../components/SplitStatusPill";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, personColor, personTint, tint } from "../utils/categoryColor";
import { currentMonthParam, formatCurrency, parseLocalDate } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  balance: number;
}

interface MemberRow {
  id: string;
  displayName: string;
}

interface GroupResponse {
  accounts: AccountRow[];
  members: MemberRow[];
}

interface TransactionListRow {
  id: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  occurredAt: string;
  payerId: string;
  accountId: string;
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  splitType: "none" | "equal";
  isSettled: boolean;
}

interface PayerSummaryRow {
  payerId: string;
  total: string;
}

interface CategorySummaryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

interface SummaryResponse {
  byPayer: PayerSummaryRow[];
  byCategory: CategorySummaryRow[];
}

interface BudgetResponse {
  budget: { capAmount: string } | null;
  spent: number;
}

interface BalanceRow {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

interface BalanceResponse {
  balances: BalanceRow[];
}

export function ParPage() {
  const { user, token } = useAuth();
  const cacheKey = (name: string) => `par:${name}:${user?.id ?? "anon"}`;

  const [group, setGroup] = useState<GroupResponse | null>(() => readCache(cacheKey("group")));
  const [summary, setSummary] = useState<SummaryResponse | null>(() => readCache(cacheKey("summary")));
  const [balance, setBalance] = useState<BalanceResponse | null>(() => readCache(cacheKey("balance")));
  const [budget, setBudget] = useState<BudgetResponse | null>(() => readCache(cacheKey("budget")));
  const [transactions, setTransactions] = useState<TransactionListRow[] | null>(() =>
    readCache(cacheKey("transactions"))
  );
  const [isLoading, setIsLoading] = useState(!group);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const month = currentMonthParam();
    // The joint-account extrato needs the joint account's id, which
    // normally only comes from /groups/me -- but that account rarely
    // changes, so once we've loaded it once (cached in `group` from a
    // previous visit), reuse it and fire this request in parallel with the
    // rest instead of waiting for a fresh /groups/me round trip first. That
    // "wait for group, then fetch extrato" sequencing was exactly why a
    // transaction just added to "Nossa conta" took a beat to show up here.
    const knownJointAccountId = group?.accounts.find((a) => a.type === "joint")?.id;

    const groupPromise = apiRequest<GroupResponse>("/groups/me", { token });
    const summaryPromise = apiRequest<SummaryResponse>(`/transactions/summary?month=${month}`, { token });
    const balancePromise = apiRequest<BalanceResponse>("/transactions/balance", { token });
    const budgetPromise = apiRequest<BudgetResponse>(`/budgets/current?month=${month}`, { token });

    async function jointTransactions(): Promise<TransactionListRow[]> {
      const jointAccountId = knownJointAccountId ?? (await groupPromise).accounts.find((a) => a.type === "joint")?.id;
      if (!jointAccountId) return [];
      return apiRequest<TransactionListRow[]>(`/transactions?limit=50&accountId=${jointAccountId}`, { token });
    }

    const [groupRes, summaryRes, balanceRes, budgetRes, txRes] = await Promise.all([
      groupPromise,
      summaryPromise,
      balancePromise,
      budgetPromise,
      jointTransactions(),
    ]);

    setGroup(groupRes);
    setSummary(summaryRes);
    setBalance(balanceRes);
    setBudget(budgetRes);
    setTransactions(txRes);
    writeCache(cacheKey("group"), groupRes);
    writeCache(cacheKey("summary"), summaryRes);
    writeCache(cacheKey("balance"), balanceRes);
    writeCache(cacheKey("budget"), budgetRes);
    writeCache(cacheKey("transactions"), txRes);
    setIsLoading(false);
  }

  useEffect(() => {
    load();
  }, [token]);

  async function handleDelete(id: string) {
    const confirmed = window.confirm("Excluir esse lançamento?");
    if (!confirmed) return;

    setDeletingId(id);
    setError(null);
    try {
      await apiRequest(`/transactions/${id}`, { method: "DELETE", token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir");
    } finally {
      setDeletingId(null);
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

  if (!group) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const jointAccount = group.accounts.find((a) => a.type === "joint");

  // Stable order: you first, then everyone else sorted by id, so color
  // assignment doesn't jitter between loads (API order isn't guaranteed).
  const others = group.members.filter((m) => m.id !== user?.id).sort((a, b) => a.id.localeCompare(b.id));
  const orderedMembers = user ? [{ id: user.id, displayName: "Você" }, ...others] : others;

  function memberName(userId: string) {
    if (userId === user?.id) return "Você";
    return group?.members.find((m) => m.id === userId)?.displayName ?? "Alguém do grupo";
  }

  function memberInitial(userId: string) {
    const realName =
      userId === user?.id
        ? user?.displayName
        : group?.members.find((m) => m.id === userId)?.displayName;
    return (realName?.charAt(0) ?? "?").toUpperCase();
  }

  const spentByUser = (userId: string | undefined) =>
    userId ? summary?.byPayer.find((row) => row.payerId === userId)?.total ?? "0" : "0";

  const pieSlices = (summary?.byCategory ?? []).map((row) => ({
    id: row.categoryId ?? "none",
    label: row.categoryName ?? "Sem categoria",
    emoji: row.categoryEmoji,
    value: Number(row.total),
    color: categoryColor(row.categoryId),
  }));

  const cap = budget?.budget ? Number(budget.budget.capAmount) : null;
  const spent = budget?.spent ?? 0;
  const rawPercent = cap ? Math.round((spent / cap) * 100) : 0;
  const budgetPercent = Math.min(100, rawPercent);
  const budgetSeverity = rawPercent >= 100 ? "over" : rawPercent >= 80 ? "warning" : "";

  return (
    <AppLayout>
      <div className="page-stack">
        {isLoading && <p className="refresh-note">Atualizando...</p>}
        <div>
          <h1>Par</h1>
          <p className="card-subtitle">
            O que é do grupo: conta conjunta e tudo que vocês lançam nela. Lançamentos em
            contas pessoais continuam só seus até decidirem mover pra cá.
          </p>
        </div>

        <div className="stat-card">
          <p className="label">{jointAccount?.name ?? "Conta conjunta"}</p>
          <p className="value">{formatCurrency(jointAccount?.balance ?? 0)}</p>
        </div>

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
              <p className="value-sm">{formatCurrency(Number(spentByUser(member.id)))}</p>
            </div>
          ))}
        </div>

        {orderedMembers.length > 1 && (
          <div className="card">
            <p className="card-title">Divisões em aberto</p>
            <p className="card-subtitle">
              Soma do que ainda está marcado "Em aberto" no extrato (não é só deste mês -- marque cada
              lançamento como pago assim que acertarem, no Pix ou como for).
            </p>
            {!balance || balance.balances.length === 0 ? (
              <p className="empty-state">Tudo em dia -- nenhuma divisão em aberto no momento.</p>
            ) : (
              <ul className="member-list">
                {balance.balances.map((row) => (
                  <li key={`${row.fromUserId}_${row.toUserId}`} className="member-row">
                    {row.fromUserId === user?.id
                      ? `${formatCurrency(row.amount)} a pagar pra ${memberName(row.toUserId)}`
                      : row.toUserId === user?.id
                        ? `${formatCurrency(row.amount)} a receber de ${memberName(row.fromUserId)}`
                        : `${formatCurrency(row.amount)} entre ${memberName(row.fromUserId)} e ${memberName(row.toUserId)}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

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
          <p className="card-title">Quem faz parte</p>
          <ul className="member-list">
            {orderedMembers.map((member, index) => (
              <li key={member.id} className="member-row">
                <span
                  className="identity-avatar"
                  style={{
                    ["--identity-avatar-color" as string]: personColor(index),
                    ["--identity-avatar-bg" as string]: personTint(personColor(index)),
                  }}
                >
                  {memberInitial(member.id)}
                </span>
                {member.displayName}
              </li>
            ))}
          </ul>
        </div>

        {orderedMembers.length > 1 && pieSlices.length > 0 && (
          <div className="card">
            <p className="card-title">Maiores gastos do casal</p>
            <p className="card-subtitle">Só o que saiu da conta conjunta esse mês.</p>
            <CategoryPieChart slices={pieSlices} />
          </div>
        )}

        <div className="card">
          <div className="section-header">
            <p className="card-title">Extrato da conta conjunta</p>
            <Link to="/transactions/new" className="link">
              + Lançar aqui
            </Link>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {transactions && transactions.length === 0 && (
            <p className="empty-state">Nada lançado na conta conjunta ainda.</p>
          )}
          <ul className="transaction-list">
            {transactions?.map((tx) => (
              <li key={tx.id} className="transaction-row">
                <span
                  className="transaction-icon"
                  style={{ background: tint(categoryColor(tx.categoryId)) }}
                >
                  {tx.categoryEmoji ?? "💸"}
                </span>
                <div className="transaction-info">
                  <span className="transaction-desc">{tx.description}</span>
                  <span className="transaction-meta">
                    {memberName(tx.payerId)} · {tx.categoryName ?? "Sem categoria"} ·{" "}
                    {parseLocalDate(tx.occurredAt).toLocaleDateString("pt-BR")}
                    {tx.splitType === "equal" && (
                      <SplitStatusPill
                        token={token}
                        transactionId={tx.id}
                        totalAmount={Number(tx.amount)}
                        isSettled={tx.isSettled}
                        onOptimisticChange={(next) => setTransactionSettled(tx.id, next)}
                        onSettled={() => load()}
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
          </ul>
        </div>
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
