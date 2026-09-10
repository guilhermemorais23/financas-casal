import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { AppLayout } from "../layouts/AppLayout";
import { categoryColor, tint } from "../utils/categoryColor";
import { formatCurrency } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
  ownerUserId: string | null;
}

interface MemberRow {
  id: string;
  displayName: string;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

interface RecurringBillRow {
  id: string;
  accountId: string;
  accountType: "personal" | "joint";
  categoryId: string | null;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  splitType: "none" | "equal";
  dayOfMonth: number;
  isActive: boolean;
  lastGeneratedMonth: string | null;
}

export function RecurringBillsPage() {
  const { user, token } = useAuth();
  const cacheKey = `recurring-bills:${user?.id ?? "anon"}`;

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [bills, setBills] = useState<RecurringBillRow[] | null>(() => readCache(cacheKey));

  const [scope, setScope] = useState<"personal" | "joint">("personal");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [payerId, setPayerId] = useState(user?.id ?? "");
  const [dayOfMonth, setDayOfMonth] = useState("");
  const [splitType, setSplitType] = useState<"none" | "equal">("none");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDay, setEditDay] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const [groupRes, categoriesRes, billsRes] = await Promise.all([
        apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }),
        apiRequest<CategoryRow[]>("/categories", { token }),
        apiRequest<RecurringBillRow[]>("/recurring-bills", { token }),
      ]);
      setAccounts(groupRes.accounts);
      setMembers(groupRes.members);
      setCategories(categoriesRes);
      setBills(billsRes);
      writeCache(cacheKey, billsRes);
      setPayerId((current) => current || user?.id || "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar as contas fixas");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const accountForScope = useMemo(
    () =>
      scope === "joint"
        ? accounts.find((a) => a.type === "joint")
        : accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id),
    [accounts, scope, user?.id]
  );

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount.replace(",", "."));
    const parsedDay = Number(dayOfMonth);
    if (!description.trim() || !(parsedAmount > 0) || !accountForScope) {
      setError("Informe descrição, valor e o dia do mês.");
      return;
    }
    if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      setError("O dia do mês precisa ser entre 1 e 31.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/recurring-bills", {
        method: "POST",
        token,
        body: {
          accountId: accountForScope.id,
          categoryId: categoryId || null,
          payerId: payerId || user?.id,
          description: description.trim(),
          amount: parsedAmount,
          transactionType: "expense",
          isPrivate: false,
          splitType: scope === "joint" ? splitType : "none",
          dayOfMonth: parsedDay,
        },
      });
      setDescription("");
      setAmount("");
      setCategoryId("");
      setDayOfMonth("");
      setSplitType("none");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta fixa");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleActive(bill: RecurringBillRow) {
    setBusyId(bill.id);
    try {
      await apiRequest(`/recurring-bills/${bill.id}`, { method: "PATCH", token, body: { isActive: !bill.isActive } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a conta fixa");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(bill: RecurringBillRow) {
    setEditingId(bill.id);
    setEditAmount(bill.amount);
    setEditDay(String(bill.dayOfMonth));
  }

  async function saveEdit(billId: string) {
    const parsedAmount = Number(editAmount.replace(",", "."));
    const parsedDay = Number(editDay);
    if (!(parsedAmount > 0) || !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      setError("Valor e dia do mês precisam ser válidos.");
      return;
    }
    setBusyId(billId);
    try {
      await apiRequest(`/recurring-bills/${billId}`, {
        method: "PATCH",
        token,
        body: { amount: parsedAmount, dayOfMonth: parsedDay },
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a conta fixa");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(billId: string) {
    const confirmed = window.confirm(
      "Excluir essa conta fixa? Os lançamentos que ela já gerou continuam no extrato -- só para de gerar novos."
    );
    if (!confirmed) return;

    setBusyId(billId);
    try {
      await apiRequest(`/recurring-bills/${billId}`, { method: "DELETE", token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a conta fixa");
      setBusyId(null);
    }
  }

  function renderBillCard(bill: RecurringBillRow) {
    const category = categories.find((c) => c.id === bill.categoryId);
    const isEditing = editingId === bill.id;
    const isBusy = busyId === bill.id;

    return (
      <div key={bill.id} className={`card debt-card${bill.isActive ? "" : " paused-bill"}`}>
        <div className="section-header">
          <p className="card-title">
            <span
              className="transaction-icon"
              style={{ background: tint(categoryColor(bill.categoryId)), marginRight: "0.5rem" }}
            >
              {category?.emoji ?? "🔁"}
            </span>
            {bill.description}
          </p>
          <div className="transaction-row-actions">
            <button
              type="button"
              className="btn-icon"
              title={bill.isActive ? "Pausar" : "Retomar"}
              disabled={isBusy}
              onClick={() => toggleActive(bill)}
            >
              {bill.isActive ? "⏸" : "▶"}
            </button>
            <button type="button" className="btn-icon" title="Editar" onClick={() => startEdit(bill)}>
              ✎
            </button>
            <button type="button" className="btn-icon" title="Excluir" disabled={isBusy} onClick={() => handleDelete(bill.id)}>
              🗑
            </button>
          </div>
        </div>

        {isEditing ? (
          <div className="field-row">
            <div className="field">
              <label htmlFor={`edit-amount-${bill.id}`}>Valor (R$)</label>
              <input
                id={`edit-amount-${bill.id}`}
                inputMode="decimal"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`edit-day-${bill.id}`}>Todo dia</label>
              <input
                id={`edit-day-${bill.id}`}
                type="number"
                min={1}
                max={31}
                value={editDay}
                onChange={(e) => setEditDay(e.target.value)}
              />
            </div>
            <div className="transaction-row-actions" style={{ alignSelf: "flex-end", paddingBottom: "0.15rem" }}>
              <button type="button" className="btn-icon" title="Salvar" disabled={isBusy} onClick={() => saveEdit(bill.id)}>
                ✓
              </button>
              <button type="button" className="btn-icon" title="Cancelar" onClick={() => setEditingId(null)}>
                ×
              </button>
            </div>
          </div>
        ) : (
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            {formatCurrency(Number(bill.amount))} · todo dia {bill.dayOfMonth}
            {!bill.isActive && " · pausada"}
            {bill.lastGeneratedMonth && ` · último lançamento em ${bill.lastGeneratedMonth}`}
          </p>
        )}
      </div>
    );
  }

  const jointBills = useMemo(() => bills?.filter((b) => b.accountType === "joint") ?? [], [bills]);
  const personalBills = useMemo(() => bills?.filter((b) => b.accountType === "personal") ?? [], [bills]);

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="card form-card">
          <h1>Contas fixas</h1>
          <p className="card-subtitle">
            Aluguel, assinaturas, mensalidades -- cadastre uma vez e ela mesma gera o lançamento todo mês, no dia
            certo, até você pausar ou excluir.
          </p>
          <form onSubmit={handleCreate}>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${scope === "personal" ? " active" : ""}`}
                onClick={() => setScope("personal")}
              >
                Pessoal
              </button>
              <button
                type="button"
                className={`segmented-option${scope === "joint" ? " active" : ""}`}
                onClick={() => setScope("joint")}
              >
                Do grupo
              </button>
            </div>

            <div className="field">
              <label htmlFor="bill-description">Descrição</label>
              <input
                id="bill-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Aluguel, Netflix, academia..."
                required
              />
            </div>

            <div className="field">
              <label htmlFor="bill-amount">Valor (R$)</label>
              <input
                id="bill-amount"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="bill-day">Todo dia</label>
              <input
                id="bill-day"
                type="number"
                min={1}
                max={31}
                placeholder="ex: 5"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="bill-category">Categoria (opcional)</label>
              <select id="bill-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.emoji ? `${category.emoji} ` : ""}
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {scope === "joint" && members.length > 1 && (
              <>
                <div className="field">
                  <label htmlFor="bill-payer">Quem paga</label>
                  <select id="bill-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={splitType === "equal"}
                    onChange={(e) => setSplitType(e.target.checked ? "equal" : "none")}
                  />
                  Dividir igualmente entre o grupo
                </label>
              </>
            )}

            {!accountForScope && (
              <p className="alert" role="alert">
                {scope === "joint" ? "O grupo ainda não tem conta conjunta." : "Você ainda não tem conta pessoal."}
              </p>
            )}

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !accountForScope}>
              {isSubmitting ? "Salvando..." : "Adicionar conta fixa"}
            </button>
          </form>
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            💞 Contas fixas do grupo
          </p>
          {bills === null ? null : jointBills.length === 0 ? (
            <EmptyState icon="✨">Nenhuma conta fixa do casal ainda.</EmptyState>
          ) : (
            <div className="page-stack">{jointBills.map(renderBillCard)}</div>
          )}
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            👤 Suas contas fixas
          </p>
          {bills === null ? null : personalBills.length === 0 ? (
            <EmptyState icon="✨">Nenhuma conta fixa pessoal ainda.</EmptyState>
          ) : (
            <div className="page-stack">{personalBills.map(renderBillCard)}</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
