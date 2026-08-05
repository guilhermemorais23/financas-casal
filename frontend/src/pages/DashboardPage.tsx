import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { formatCurrency, currentMonthParam } from "../utils/format";

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

export function DashboardPage() {
  const { user, token } = useAuth();
  const [group, setGroup] = useState<GroupResponse | null>(null);
  const [personalMonthTx, setPersonalMonthTx] = useState<TransactionListRow[]>([]);
  const [recent, setRecent] = useState<TransactionListRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

      const [personalMonthRes, recentRes] = await Promise.all([
        personalAccount
          ? apiRequest<TransactionListRow[]>(
              `/transactions?limit=100&month=${month}&accountId=${personalAccount.id}`,
              { token }
            )
          : Promise.resolve([]),
        apiRequest<TransactionListRow[]>("/transactions?limit=5", { token }),
      ]);

      setGroup(groupRes);
      setPersonalMonthTx(personalMonthRes);
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

  const personalAccount = group.accounts.find(
    (account) => account.type === "personal" && account.ownerUserId === user?.id
  );
  const income = personalMonthTx
    .filter((tx) => tx.transactionType === "income")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);
  const expense = personalMonthTx
    .filter((tx) => tx.transactionType === "expense")
    .reduce((sum, tx) => sum + Number(tx.amount), 0);

  return (
    <AppLayout>
      <div className="dashboard">
        <div className="stat-row wrap">
          <div className="stat-box tone-good">
            <p className="label">Entrada do mês</p>
            <p className="value-sm income-text">{formatCurrency(income)}</p>
          </div>
          <div className="stat-box tone-warm">
            <p className="label">Saída do mês</p>
            <p className="value-sm">{formatCurrency(expense)}</p>
          </div>
          <div className="stat-box tone-accent">
            <p className="label">Você tem</p>
            <p className="value-sm">{formatCurrency(personalAccount?.balance ?? 0)}</p>
          </div>
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
