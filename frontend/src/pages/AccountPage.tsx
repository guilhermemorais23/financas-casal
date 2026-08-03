import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { currentMonthParam, formatCurrency } from "../utils/format";

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
  pendingInviteToken: string | null;
}

interface BudgetResponse {
  budget: { cap_amount: string } | null;
  spent: number;
}

export function AccountPage() {
  const { user, token, logout } = useAuth();
  const [couple, setCouple] = useState<CoupleResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [capInput, setCapInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const month = currentMonthParam();

  async function load() {
    const [coupleRes, budgetRes] = await Promise.all([
      apiRequest<CoupleResponse>("/couples/me", { token }),
      apiRequest<BudgetResponse>(`/budgets/current?month=${month}`, { token }),
    ]);
    setCouple(coupleRes);
    setBudget(budgetRes);
    setCapInput(budgetRes.budget ? budgetRes.budget.cap_amount : "");
  }

  useEffect(() => {
    load();
  }, [token]);

  async function handleSaveBudget(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const capAmount = Number(capInput.replace(",", "."));
    if (!(capAmount > 0)) {
      setError("Informe um valor válido para o orçamento.");
      return;
    }

    setIsSaving(true);
    try {
      await apiRequest(`/budgets/current?month=${month}`, {
        method: "PUT",
        token,
        body: { capAmount },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o orçamento");
    } finally {
      setIsSaving(false);
    }
  }

  function copyInvite() {
    if (!couple?.pendingInviteToken) return;
    const link = `${window.location.origin}/invite/${couple.pendingInviteToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!couple) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="page-stack">
        <h1>Conta</h1>

        <div className="card">
          <p className="card-title">Casal</p>
          <ul className="member-list">
            {couple.members.map((member) => (
              <li key={member.id} className="member-row">
                <span className="onboarding-avatars-inline circle" />
                {member.id === user?.id ? "Você" : member.display_name}
              </li>
            ))}
          </ul>
          {couple.pendingInviteToken && (
            <div className="invite-link-row" style={{ marginTop: "1rem" }}>
              <input
                readOnly
                value={`${window.location.origin}/invite/${couple.pendingInviteToken}`}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="btn btn-outline" onClick={copyInvite}>
                {copied ? "Copiado!" : "Copiar convite"}
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <p className="card-title">Contas</p>
          <ul className="account-list">
            {couple.accounts.map((account) => (
              <li key={account.id} className="account-row">
                <span>
                  {account.emoji ?? (account.type === "joint" ? "🏠" : "👤")} {account.name}
                </span>
                <span className="value">{formatCurrency(account.balance)}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card form-card">
          <p className="card-title">Orçamento do mês</p>
          <p className="card-subtitle">Definam um teto mensal e acompanhem no painel.</p>
          <form onSubmit={handleSaveBudget}>
            <div className="field">
              <label htmlFor="budget-cap">Teto (R$)</label>
              <input
                id="budget-cap"
                inputMode="decimal"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value)}
              />
            </div>
            {budget && budget.budget && (
              <p className="card-subtitle">Gasto até agora: {formatCurrency(budget.spent)}</p>
            )}
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Salvando..." : "Salvar orçamento"}
            </button>
          </form>
        </div>

        <button type="button" className="btn btn-outline" onClick={logout}>
          Sair da conta
        </button>
      </div>
    </AppLayout>
  );
}
