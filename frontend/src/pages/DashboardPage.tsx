import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { formatCurrency, currentMonthParam } from "../utils/format";
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
}

interface InstallmentRow {
  id: string;
  installmentNumber: number;
  amount: string;
  isPaid: boolean;
}

interface DebtRow {
  id: string;
  scope: "personal" | "joint";
  name: string;
  totalAmount: string;
  installmentsCount: number;
  installments: InstallmentRow[];
  paidAmount: number;
  remainingAmount: number;
  remainingCount: number;
}

export function DashboardPage() {
  const { user, token } = useAuth();
  const cacheKey = (name: string) => `dashboard:${name}:${user?.id ?? "anon"}`;

  const [group, setGroup] = useState<GroupResponse | null>(() => readCache(cacheKey("group")));
  const [personalMonthTx, setPersonalMonthTx] = useState<TransactionListRow[]>(
    () => readCache(cacheKey("personalMonthTx")) ?? []
  );
  const [recent, setRecent] = useState<TransactionListRow[]>(() => readCache(cacheKey("recent")) ?? []);
  const [debts, setDebts] = useState<DebtRow[]>(() => readCache(cacheKey("debts")) ?? []);
  const [isLoading, setIsLoading] = useState(!group);
  const [error, setError] = useState<string | null>(null);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setError(null);
    const month = currentMonthParam();
    try {
      const groupRes = await apiRequest<GroupResponse>("/groups/me", { token });
      const personalAccount = groupRes.accounts.find(
        (account) => account.type === "personal" && account.ownerUserId === user?.id
      );

      const [personalMonthRes, recentRes, debtsRes] = await Promise.all([
        personalAccount
          ? apiRequest<TransactionListRow[]>(
              `/transactions?limit=100&month=${month}&accountId=${personalAccount.id}`,
              { token }
            )
          : Promise.resolve([]),
        apiRequest<TransactionListRow[]>("/transactions?limit=5", { token }),
        apiRequest<DebtRow[]>("/debts", { token }),
      ]);

      setGroup(groupRes);
      setPersonalMonthTx(personalMonthRes);
      setRecent(recentRes);
      setDebts(debtsRes);
      writeCache(cacheKey("group"), groupRes);
      writeCache(cacheKey("personalMonthTx"), personalMonthRes);
      writeCache(cacheKey("recent"), recentRes);
      writeCache(cacheKey("debts"), debtsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [token]);

  async function handleDelete(id: string) {
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

  if (error && !group) {
    return (
      <AppLayout>
        <p className="alert" role="alert">
          {error}
        </p>
      </AppLayout>
    );
  }

  if (!group) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const personalAccount = group.accounts.find(
    (account) => account.type === "personal" && account.ownerUserId === user?.id
  );
  const income = personalMonthTx
    .filter((tx) => tx.transactionType === "income")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expense = personalMonthTx
    .filter((tx) => tx.transactionType === "expense")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  const debtsWithPending = debts.filter((debt) => debt.remainingCount > 0);
  const pendingPersonalInstallments = debtsWithPending
    .filter((debt) => debt.scope === "personal")
    .reduce((sum, debt) => {
      const next = debt.installments.find((installment) => !installment.isPaid);
      return sum + (next ? Number(next.amount) : 0);
    }, 0);

  return (
    <AppLayout>
      <div className="dashboard">
        {isLoading && <p className="refresh-note">Atualizando...</p>}
        <div className="stat-row wrap">
          <div className="stat-box tone-good">
            <div className="stat-box-header">
              <span className="stat-box-icon">📈</span>
              <p className="label">Entrada do mês</p>
            </div>
            <p className="value-sm income-text">{formatCurrency(income)}</p>
          </div>
          <div className="stat-box tone-warm">
            <div className="stat-box-header">
              <span className="stat-box-icon">📉</span>
              <p className="label">Saída do mês</p>
            </div>
            <p className="value-sm">{formatCurrency(expense)}</p>
          </div>
          <div className="stat-box tone-accent">
            <div className="stat-box-header">
              <span className="stat-box-icon">👛</span>
              <p className="label">Você tem</p>
            </div>
            <p className="value-sm">{formatCurrency(personalAccount?.balance ?? 0)}</p>
            {pendingPersonalInstallments > 0 && (
              <p className="stat-box-note">
                considerando parcelas do mês: −{formatCurrency(pendingPersonalInstallments)}
              </p>
            )}
          </div>
        </div>

        {debtsWithPending.length > 0 && (
          <div className="card">
            <div className="section-header">
              <p className="card-title">💳 Dívidas em aberto</p>
              <Link to="/debts" className="link">
                Ver tudo
              </Link>
            </div>
            <div className="debt-mini-list">
              {debtsWithPending.map((debt) => {
                const next = debt.installments.find((installment) => !installment.isPaid);
                const percent = Math.round((debt.paidAmount / Number(debt.totalAmount)) * 100);
                return (
                  <div className="debt-mini-card" key={debt.id}>
                    <div className="debt-mini-header">
                      <span className="debt-mini-name">
                        {debt.scope === "joint" ? "💞 " : ""}
                        {debt.name}
                      </span>
                      {next && debt.installmentsCount > 1 && (
                        <span className="debt-mini-badge">
                          parcela {next.installmentNumber} de {debt.installmentsCount}
                        </span>
                      )}
                    </div>
                    <div className="debt-mini-row">
                      <span className="debt-mini-value">
                        {next ? formatCurrency(Number(next.amount)) : "—"}
                      </span>
                      <span className="debt-mini-remaining">
                        faltam {formatCurrency(debt.remainingAmount)}
                      </span>
                    </div>
                    <div className="progress-track thin">
                      <div className="progress-fill" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="card">
          <div className="section-header">
            <p className="card-title">Extrato recente</p>
            <Link to="/reports" className="link">
              Ver tudo
            </Link>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {recent.length === 0 ? (
            <p className="empty-state">Nenhuma despesa lançada ainda.</p>
          ) : (
            <ul className="transaction-list">
              {recent.map((tx) => (
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
                      {tx.categoryName ?? "Sem categoria"} ·{" "}
                      {new Date(tx.occurredAt).toLocaleDateString("pt-BR")}
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
