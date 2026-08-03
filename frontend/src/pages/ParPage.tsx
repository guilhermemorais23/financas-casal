import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditTransactionModal } from "../components/EditTransactionModal";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { formatCurrency } from "../utils/format";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  balance: number;
}

interface MemberRow {
  id: string;
  display_name: string;
}

interface CoupleResponse {
  accounts: AccountRow[];
  members: MemberRow[];
}

interface TransactionListRow {
  id: string;
  description: string;
  amount: string;
  transaction_type: "expense" | "income";
  occurred_at: string;
  payer_id: string;
  category_id: string | null;
  category_name: string | null;
  category_emoji: string | null;
}

export function ParPage() {
  const { user, token } = useAuth();
  const [couple, setCouple] = useState<CoupleResponse | null>(null);
  const [transactions, setTransactions] = useState<TransactionListRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTx, setEditingTx] = useState<TransactionListRow | null>(null);

  async function load() {
    const coupleRes = await apiRequest<CoupleResponse>("/couples/me", { token });
    setCouple(coupleRes);
    const jointAccount = coupleRes.accounts.find((a) => a.type === "joint");
    if (jointAccount) {
      const txRes = await apiRequest<TransactionListRow[]>(
        `/transactions?limit=50&accountId=${jointAccount.id}`,
        { token }
      );
      setTransactions(txRes);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    load();
  }, [token]);

  if (isLoading || !couple) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const jointAccount = couple.accounts.find((a) => a.type === "joint");

  function memberName(userId: string) {
    if (userId === user?.id) return "Você";
    return couple?.members.find((m) => m.id === userId)?.display_name ?? "Parceiro(a)";
  }

  return (
    <AppLayout>
      <div className="page-stack">
        <div>
          <h1>Par</h1>
          <p className="card-subtitle">
            O que é dos dois: conta conjunta e tudo que vocês lançam nela. Lançamentos em
            contas pessoais continuam só seus até você decidir mover pra cá.
          </p>
        </div>

        <div className="stat-card">
          <p className="label">{jointAccount?.name ?? "Conta conjunta"}</p>
          <p className="value">{formatCurrency(jointAccount?.balance ?? 0)}</p>
        </div>

        <div className="card">
          <p className="card-title">Quem faz parte</p>
          <ul className="member-list">
            {couple.members.map((member) => (
              <li key={member.id} className="member-row">
                <span className="onboarding-avatars-inline circle" />
                {member.id === user?.id ? "Você" : member.display_name}
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <div className="section-header">
            <p className="card-title">Extrato da conta conjunta</p>
            <Link to="/transactions/new" className="link">
              + Lançar aqui
            </Link>
          </div>
          {transactions && transactions.length === 0 && (
            <p className="empty-state">Nada lançado na conta conjunta ainda.</p>
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
                  <span className="transaction-desc">{tx.description}</span>
                  <span className="transaction-meta">
                    {memberName(tx.payer_id)} · {tx.category_name ?? "Sem categoria"} ·{" "}
                    {new Date(tx.occurred_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <span className={`transaction-amount ${tx.transaction_type}`}>
                  {tx.transaction_type === "income" ? "+" : "-"}
                  {formatCurrency(Number(tx.amount))}
                </span>
                <button type="button" className="btn-icon" title="Editar" onClick={() => setEditingTx(tx)}>
                  ✎
                </button>
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
