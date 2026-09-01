import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { personColor, personTint } from "../utils/categoryColor";
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
  displayName: string;
}

interface GroupResponse {
  accounts: AccountRow[];
  members: MemberRow[];
  pendingInviteToken: string | null;
}

interface BudgetResponse {
  budget: { capAmount: string } | null;
  spent: number;
}

interface CategoryBudgetRow {
  categoryId: string;
  categoryName: string;
  categoryEmoji: string | null;
  capAmount: string | null;
  spent: number;
}

export function AccountPage() {
  const { user, token, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [group, setGroup] = useState<GroupResponse | null>(null);
  const [budget, setBudget] = useState<BudgetResponse | null>(null);
  const [capInput, setCapInput] = useState("");
  const [categoryBudgets, setCategoryBudgets] = useState<CategoryBudgetRow[] | null>(null);
  const [categoryCapInputs, setCategoryCapInputs] = useState<Record<string, string>>({});
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [whatsappCode, setWhatsappCode] = useState<string | null>(null);
  const [isGeneratingWhatsappCode, setIsGeneratingWhatsappCode] = useState(false);

  const month = currentMonthParam();

  async function load() {
    const [groupRes, budgetRes, categoryBudgetsRes] = await Promise.all([
      apiRequest<GroupResponse>("/groups/me", { token }),
      apiRequest<BudgetResponse>(`/budgets/current?month=${month}`, { token }),
      apiRequest<CategoryBudgetRow[]>(`/budgets/categories?month=${month}`, { token }),
    ]);
    setGroup(groupRes);
    setBudget(budgetRes);
    setCapInput(budgetRes.budget ? budgetRes.budget.capAmount : "");
    setCategoryBudgets(categoryBudgetsRes);
    setCategoryCapInputs(
      Object.fromEntries(categoryBudgetsRes.map((row) => [row.categoryId, row.capAmount ?? ""]))
    );
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

  async function handleSaveCategoryBudget(categoryId: string) {
    if (savingCategoryId) return;
    setError(null);
    const raw = (categoryCapInputs[categoryId] ?? "").trim();
    const capAmount = raw === "" ? null : Number(raw.replace(",", "."));
    if (capAmount !== null && !(capAmount > 0)) {
      setError("Informe um valor válido para o teto da categoria, ou deixe em branco pra remover.");
      return;
    }

    setSavingCategoryId(categoryId);
    try {
      await apiRequest(`/budgets/categories/${categoryId}?month=${month}`, {
        method: "PUT",
        token,
        body: { capAmount },
      });
      await load();
      showToast(capAmount === null ? "Teto da categoria removido" : "Teto da categoria salvo");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o teto da categoria");
    } finally {
      setSavingCategoryId(null);
    }
  }

  function copyInvite() {
    if (!group?.pendingInviteToken) return;
    const link = `${window.location.origin}/invite/${group.pendingInviteToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNewInvite() {
    setError(null);
    setIsInviting(true);
    try {
      await apiRequest("/groups/invite", { method: "POST", token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar o convite");
    } finally {
      setIsInviting(false);
    }
  }

  async function handleLeaveGroup() {
    const confirmed = window.confirm(
      "Desvincular sua conta desse grupo? Você continua usando o app individualmente e pode criar ou entrar em outro grupo depois."
    );
    if (!confirmed) return;

    setError(null);
    setIsLeaving(true);
    try {
      await apiRequest("/groups/leave", { method: "POST", token });
      await refreshUser();
      navigate("/group-setup");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível desvincular a conta");
      setIsLeaving(false);
    }
  }

  // The link-code endpoint is channel-agnostic (it's just "a code tied to
  // this user+group", redeemed by whichever bot/webhook it's sent to first)
  // -- Telegram and WhatsApp share the exact same call, just displayed in
  // their own card with their own loading state.
  async function generateLinkCode(): Promise<string> {
    const res = await apiRequest<{ code: string }>("/assistant/telegram/link-code", { method: "POST", token });
    return res.code;
  }

  async function handleGenerateTelegramCode() {
    setError(null);
    setIsGeneratingCode(true);
    try {
      setTelegramCode(await generateLinkCode());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar o código");
    } finally {
      setIsGeneratingCode(false);
    }
  }

  async function handleGenerateWhatsappCode() {
    setError(null);
    setIsGeneratingWhatsappCode(true);
    try {
      setWhatsappCode(await generateLinkCode());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível gerar o código");
    } finally {
      setIsGeneratingWhatsappCode(false);
    }
  }

  if (!group) {
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
          <p className="card-title">Grupo</p>
          <ul className="member-list">
            {[...group.members]
              .sort((a, b) => (a.id === user?.id ? -1 : b.id === user?.id ? 1 : a.id.localeCompare(b.id)))
              .map((member, index) => (
                <li key={member.id} className="member-row">
                  <span
                    className="identity-avatar"
                    style={{
                      ["--identity-avatar-color" as string]: personColor(index),
                      ["--identity-avatar-bg" as string]: personTint(personColor(index)),
                    }}
                  >
                    {member.displayName.charAt(0).toUpperCase()}
                  </span>
                  {member.id === user?.id ? "Você" : member.displayName}
                </li>
              ))}
          </ul>
          {group.pendingInviteToken ? (
            <div className="invite-link-row" style={{ marginTop: "1rem" }}>
              <input
                readOnly
                value={`${window.location.origin}/invite/${group.pendingInviteToken}`}
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="btn btn-outline" onClick={copyInvite}>
                {copied ? "Copiado!" : "Copiar convite"}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-outline"
              style={{ marginTop: "1rem" }}
              onClick={handleNewInvite}
              disabled={isInviting}
            >
              {isInviting ? "Gerando..." : "Gerar link de convite"}
            </button>
          )}
        </div>

        <div className="card">
          <p className="card-title">Contas</p>
          <ul className="account-list">
            {group.accounts.map((account) => (
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

        <div className="card">
          <p className="card-title">Orçamento por categoria</p>
          <p className="card-subtitle">Defina um teto pra cada categoria. Deixe em branco pra não acompanhar.</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {categoryBudgets && categoryBudgets.length === 0 && (
            <p className="empty-state">Crie categorias em "Nova despesa" pra poder definir tetos aqui.</p>
          )}
          {categoryBudgets?.map((row) => (
            <div key={row.categoryId} className="category-budget-row">
              <span className="category-budget-emoji">{row.categoryEmoji ?? "✨"}</span>
              <div className="category-budget-info">
                <span className="category-budget-name">{row.categoryName}</span>
                <span className="category-budget-spent">gasto: {formatCurrency(row.spent)}</span>
              </div>
              <input
                className="category-budget-input"
                inputMode="decimal"
                placeholder="sem teto"
                aria-label={`Teto de ${row.categoryName}`}
                value={categoryCapInputs[row.categoryId] ?? ""}
                onChange={(e) =>
                  setCategoryCapInputs((prev) => ({ ...prev, [row.categoryId]: e.target.value }))
                }
              />
              <button
                type="button"
                className="btn-icon"
                title={`Salvar teto de ${row.categoryName}`}
                onClick={() => handleSaveCategoryBudget(row.categoryId)}
                disabled={savingCategoryId === row.categoryId}
              >
                {savingCategoryId === row.categoryId ? "..." : "✓"}
              </button>
            </div>
          ))}
        </div>

        <div className="card">
          <p className="card-title">Assistente (WhatsApp)</p>
          <p className="card-subtitle">
            Ainda em fase de teste (número de teste da Meta) -- fale seus gastos ou pergunte sobre suas finanças por
            lá. Gere um código aqui e envie ele pro número de teste que aparece no seu WhatsApp Business.
          </p>
          {whatsappCode && (
            <p className="card-subtitle" style={{ color: "var(--color-text)", fontWeight: 700, fontSize: "1.1rem" }}>
              {whatsappCode}
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleGenerateWhatsappCode}
            disabled={isGeneratingWhatsappCode}
          >
            {isGeneratingWhatsappCode ? "Gerando..." : whatsappCode ? "Gerar novo código" : "Gerar código"}
          </button>
        </div>

        <div className="card">
          <p className="card-title">Assistente (Telegram)</p>
          <p className="card-subtitle">
            Fale seus gastos ou pergunte sobre suas finanças pelo Telegram. Gere um código aqui e envie ele pro bot
            pra vincular sua conta.
          </p>
          {telegramCode && (
            <p className="card-subtitle" style={{ color: "var(--color-text)", fontWeight: 700, fontSize: "1.1rem" }}>
              {telegramCode}
            </p>
          )}
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleGenerateTelegramCode}
            disabled={isGeneratingCode}
          >
            {isGeneratingCode ? "Gerando..." : telegramCode ? "Gerar novo código" : "Gerar código"}
          </button>
        </div>

        <button type="button" className="btn btn-outline" onClick={logout}>
          Sair da conta
        </button>

        <button type="button" className="btn btn-ghost danger-text" onClick={handleLeaveGroup} disabled={isLeaving}>
          {isLeaving ? "Desvinculando..." : "Desvincular conta do grupo"}
        </button>

        <p className="app-version-footer">PAR. v{__APP_VERSION__}</p>
      </div>
    </AppLayout>
  );
}
