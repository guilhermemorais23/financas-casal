import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency, parseLocalDate, todayISO } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";
import { Icon } from "../components/Icon";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { BillsTabs } from "../components/BillsTabs";
import { MonthBillsCard, parseMoney } from "../components/BillReminders";
import { Sheet } from "../components/Sheet";

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
  // null quando é "Não sei ainda".
  amount: string | null;
  amountMode?: AmountMode;
  remindDaysBefore?: number;
  expectedAmount?: number | null;
  transactionType: "expense" | "income";
  splitType: "none" | "equal";
  dayOfMonth: number;
  isActive: boolean;
  lastGeneratedMonth: string | null;
}

// Conta "só esta vez": por baixo é uma dívida de 1 parcela (POST /debts), com
// o vencimento guardado como mês + dia.
interface SingleBillRow {
  id: string;
  scope: "personal" | "joint";
  name: string;
  totalAmount: string;
  installmentsCount: number;
  installments: { id: string; isPaid: boolean; dueDate: string | null }[];
}

type AmountMode = "fixed" | "estimate" | "unknown";
type Repeat = "once" | "month";

function singleDueText(dueDate: string | null): { text: string; tone: "late" | "soon" | "" } {
  if (!dueDate) return { text: "Sem dia de vencimento", tone: "" };
  const days = Math.round((parseLocalDate(dueDate).getTime() - parseLocalDate(todayISO()).getTime()) / 86_400_000);
  const short = parseLocalDate(dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (days < 0) return { text: `Venceu ${short}`, tone: "late" };
  if (days === 0) return { text: "Vence hoje", tone: "soon" };
  if (days === 1) return { text: "Vence amanhã", tone: "soon" };
  if (days <= 7) return { text: `Vence em ${days} dias`, tone: "soon" };
  return { text: `Vence ${short}`, tone: "" };
}

const AMOUNT_MODES: { mode: AmountMode; label: string; hint: string }[] = [
  { mode: "fixed", label: "Sei o valor", hint: "Lança sozinha no extrato no dia do vencimento." },
  {
    mode: "estimate",
    label: "Mais ou menos",
    hint: "Entra como previsão (≈). Quando a conta chegar, você confirma o valor real.",
  },
  { mode: "unknown", label: "Não sei ainda", hint: "O PAR. só lembra de pagar. O valor você informa quando souber." },
];

const REMIND_OPTIONS: { days: number; label: string }[] = [
  { days: 0, label: "No dia" },
  { days: 1, label: "1 dia antes" },
  { days: 3, label: "3 dias antes" },
  { days: 7, label: "1 semana antes" },
];

function remindLabel(days: number): string {
  return days === 0 ? "avisa no dia" : days === 1 ? "avisa 1 dia antes" : days === 7 ? "avisa 1 semana antes" : `avisa ${days} dias antes`;
}

// `embedded`: dentro da aba "A pagar" (sem o próprio AppLayout e abas).
export function RecurringBillsPage({ embedded = false }: { embedded?: boolean }) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const cacheKey = `recurring-bills:${user?.id ?? "anon"}`;

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [listScope, setListScope] = useState<"joint" | "personal">("joint");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [bills, setBills] = useState<RecurringBillRow[] | null>(() => readCache(cacheKey));

  const [singles, setSingles] = useState<SingleBillRow[]>([]);
  // Pagas agora há pouco: continuam na lista como "Pago" até sair da tela.
  const [paidNow, setPaidNow] = useState<string[]>([]);

  const [repeat, setRepeat] = useState<Repeat>("once");
  const [dueDate, setDueDate] = useState("");
  const [scope, setScope] = useState<"personal" | "joint">("personal");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [amountMode, setAmountMode] = useState<AmountMode>("fixed");
  const [remindDays, setRemindDays] = useState(3);
  const [categoryId, setCategoryId] = useState("");
  const [payerId, setPayerId] = useState(user?.id ?? "");
  const [dayOfMonth, setDayOfMonth] = useState("");
  const [splitType, setSplitType] = useState<"none" | "equal">("none");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editMode, setEditMode] = useState<AmountMode>("fixed");
  const [editDay, setEditDay] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      const [groupRes, categoriesRes, billsRes, debtsRes] = await Promise.all([
        apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }),
        apiRequest<CategoryRow[]>("/categories", { token }),
        apiRequest<RecurringBillRow[]>("/recurring-bills", { token }),
        // As contas "só esta vez" são extra: se falharem, as fixas aparecem igual.
        apiRequest<SingleBillRow[]>("/debts", { token }).catch(() => null),
      ]);
      setAccounts(groupRes.accounts);
      setMembers(groupRes.members);
      setCategories(categoriesRes);
      setBills(billsRes);
      if (debtsRes) setSingles(debtsRes.filter((debt) => debt.installmentsCount === 1));
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
    if (repeat === "once") {
      await createSingle();
      return;
    }

    const parsedAmount = parseMoney(amount);
    const parsedDay = Number(dayOfMonth);
    const needsAmount = amountMode !== "unknown";
    if (!description.trim() || (needsAmount && !(parsedAmount > 0)) || !accountForScope) {
      setError(needsAmount ? "Informe descrição, valor e o dia do mês." : "Informe a descrição e o dia do mês.");
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
          amount: needsAmount ? parsedAmount : null,
          amountMode,
          remindDaysBefore: remindDays,
          transactionType: "expense",
          isPrivate: false,
          splitType: scope === "joint" ? splitType : "none",
          dayOfMonth: parsedDay,
        },
      });
      setDescription("");
      setAmount("");
      setAmountMode("fixed");
      setRemindDays(3);
      setCategoryId("");
      setDayOfMonth("");
      setSplitType("none");
      showToast(amountMode === "fixed" ? "Conta fixa criada" : "Conta salva. O PAR. avisa antes de vencer.");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta fixa");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function createSingle() {
    const parsedAmount = parseMoney(amount);
    if (!description.trim() || !(parsedAmount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Informe a descrição, o valor e o vencimento.");
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest("/debts", {
        method: "POST",
        token,
        body: {
          name: description.trim(),
          description: null,
          totalAmount: parsedAmount,
          installmentsCount: 1,
          scope,
          startMonth: dueDate.slice(0, 7),
          dueDay: Number(dueDate.slice(8, 10)),
        },
      });
      const when = parseLocalDate(dueDate).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
      showToast("Conta salva", {
        description: dueDate < todayISO() ? `Venceu em ${when}. Aparece como atrasada.` : `Vence em ${when}.`,
      });
      setDescription("");
      setAmount("");
      setDueDate("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a conta");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function paySingle(single: SingleBillRow) {
    const installment = single.installments[0];
    if (!installment || installment.isPaid) return;
    setBusyId(single.id);
    try {
      await apiRequest(`/debts/${single.id}/installments/${installment.id}`, { method: "PATCH", token, body: { isPaid: true } });
      setPaidNow((current) => [...current, single.id]);
      showToast(`${single.name}: paga`, { description: "Lançado hoje no extrato" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível marcar como paga");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSingle(single: SingleBillRow) {
    const confirmed = await confirm({
      title: "Excluir essa conta?",
      body: single.installments[0]?.isPaid
        ? "O lançamento que ela gerou também sai do extrato."
        : "Ela some da lista de contas a pagar.",
      confirmLabel: "Excluir conta",
    });
    if (!confirmed) return;
    setBusyId(single.id);
    try {
      await apiRequest(`/debts/${single.id}`, { method: "DELETE", token });
      showToast("Conta excluída");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível excluir a conta");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(bill: RecurringBillRow) {
    setBusyId(bill.id);
    try {
      await apiRequest(`/recurring-bills/${bill.id}`, { method: "PATCH", token, body: { isActive: !bill.isActive } });
      showToast(bill.isActive ? "Conta fixa pausada" : "Conta fixa ativada", bill.isActive ? { variant: "info" } : undefined);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a conta fixa");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(bill: RecurringBillRow) {
    setEditingId(bill.id);
    setEditAmount(bill.amount ? bill.amount.replace(".", ",") : "");
    setEditMode(bill.amountMode ?? "fixed");
    setEditDay(String(bill.dayOfMonth));
  }

  async function saveEdit(billId: string) {
    const parsedAmount = parseMoney(editAmount);
    const parsedDay = Number(editDay);
    const needsAmount = editMode !== "unknown";
    if ((needsAmount && !(parsedAmount > 0)) || !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      setError("Valor e dia do mês precisam ser válidos.");
      return;
    }
    setBusyId(billId);
    try {
      await apiRequest(`/recurring-bills/${billId}`, {
        method: "PATCH",
        token,
        body: { amount: needsAmount ? parsedAmount : null, amountMode: editMode, dayOfMonth: parsedDay },
      });
      setEditingId(null);
      showToast("Conta fixa salva");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a conta fixa");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(billId: string) {
    const confirmed = await confirm({
      title: "Excluir essa conta fixa?",
      body: "Os lançamentos que ela já gerou continuam no extrato. Ela só para de gerar novos.",
      confirmLabel: "Excluir conta",
    });
    if (!confirmed) return;

    setBusyId(billId);
    try {
      await apiRequest(`/recurring-bills/${billId}`, { method: "DELETE", token });
      showToast("Conta fixa excluída");
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
      <li key={bill.id} className={`bill-row${bill.isActive ? "" : " paused-bill"}`}>
        <span className="bill-day" aria-label={`Todo dia ${bill.dayOfMonth}`}>
          <small>dia</small>
          <strong>{bill.dayOfMonth}</strong>
        </span>
        <div className="bill-info">
          <span className="bill-name text-truncate">{bill.description}</span>
          {isEditing ? (
            <div className="field-row bill-edit">
              <div className="field">
                <label htmlFor={`edit-mode-${bill.id}`}>Valor</label>
                <select id={`edit-mode-${bill.id}`} value={editMode} onChange={(e) => setEditMode(e.target.value as AmountMode)}>
                  {AMOUNT_MODES.map((option) => (
                    <option key={option.mode} value={option.mode}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {editMode !== "unknown" && (
                <div className="field">
                  <label htmlFor={`edit-amount-${bill.id}`}>{editMode === "estimate" ? "Estimativa (R$)" : "Valor (R$)"}</label>
                  <input
                    id={`edit-amount-${bill.id}`}
                    inputMode="decimal"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                  />
                </div>
              )}
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
            <span className="bill-meta text-truncate">
              {category?.name ?? "Sem categoria"}
              {bill.splitType === "equal" && ", dividida igualmente"}
              {(bill.amountMode ?? "fixed") !== "fixed" && `, ${remindLabel(bill.remindDaysBefore ?? 3)}`}
              {!bill.isActive && ", pausada"}
            </span>
          )}
        </div>
        {!isEditing && (
          <strong className={`bill-amount${(bill.amountMode ?? "fixed") !== "fixed" ? ` ${bill.amountMode}` : ""}`}>
            {bill.amountMode === "unknown" ? "sem valor" : `${bill.amountMode === "estimate" ? "≈ " : ""}${formatCurrency(bill.expectedAmount ?? Number(bill.amount ?? 0))}`}
          </strong>
        )}
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
            <Icon name="pencil" />
          </button>
          <button type="button" className="btn-icon" title="Excluir" disabled={isBusy} onClick={() => handleDelete(bill.id)}>
            <Icon name="trash" />
          </button>
        </div>
      </li>
    );
  }

  const listedBills = useMemo(
    () => (bills ?? []).filter((b) => b.accountType === listScope).sort((a, b) => a.dayOfMonth - b.dayOfMonth),
    [bills, listScope]
  );
  const monthlyTotal = listedBills
    .filter((b) => b.isActive && b.transactionType === "expense")
    .reduce((sum, b) => sum + (b.expectedAmount ?? Number(b.amount ?? 0)), 0);
  const hasVariable = listedBills.some((b) => b.isActive && (b.amountMode ?? "fixed") !== "fixed");
  const listedSingles = singles.filter((single) => !single.installments[0]?.isPaid || paidNow.includes(single.id));
  const singlesToPay = listedSingles
    .filter((single) => !single.installments[0]?.isPaid)
    .reduce((sum, single) => sum + Number(single.totalAmount), 0);

  function openForm() {
    setError(null);
    setRepeat("once");
    setShowForm(true);
  }

  const content = (
    <>
        <div className="page-title-row">
          <h1>Contas</h1>
          <button type="button" className="btn btn-primary btn-compact" aria-haspopup="dialog" onClick={openForm}>
            Nova conta
          </button>
        </div>

        <MonthBillsCard onChanged={() => void load()} />

        {error && !showForm && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {listedSingles.length > 0 && (
          <section className="bills-section" aria-label="Só esta vez">
            <h2 className="bills-section-title">
              <span>Só esta vez</span>
              <span>{formatCurrency(singlesToPay)}</span>
            </h2>
            <ul className="bills-list">
              {listedSingles.map((single) => {
                const installment = single.installments[0];
                const isPaid = installment?.isPaid ?? false;
                const due = singleDueText(installment?.dueDate ?? null);
                return (
                  <li key={single.id} className={`bill-row${isPaid ? " is-paid" : ""}`}>
                    <div className="bill-row-main">
                      <span className="bill-row-icon" aria-hidden="true">
                        <Icon name="file" />
                      </span>
                      <span className="bill-row-text">
                        <span className="bill-row-title">{single.name}</span>
                        <span className="bill-row-meta">
                          <span className="bill-tag">Conta</span>
                          Só esta vez{single.scope === "joint" ? ", do grupo" : ""}
                        </span>
                        {!isPaid && <span className={`bill-row-due ${due.tone}`}>{due.text}</span>}
                      </span>
                    </div>
                    <span className="bill-row-side">
                      <span className="bill-row-amount">{formatCurrency(Number(single.totalAmount))}</span>
                      <span className="transaction-row-actions">
                        {isPaid ? (
                          <span className="bill-pay done static">
                            <Icon name="check" /> Pago
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="bill-pay"
                            onClick={() => void paySingle(single)}
                            disabled={busyId === single.id}
                            aria-label={`Marcar ${single.name} como paga`}
                          >
                            Pagar
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-icon"
                          title="Excluir"
                          disabled={busyId === single.id}
                          onClick={() => void deleteSingle(single)}
                        >
                          <Icon name="trash" />
                        </button>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <div className="segmented">
          <button
            type="button"
            className={`segmented-option${listScope === "joint" ? " active" : ""}`}
            onClick={() => setListScope("joint")}
          >
            Do grupo
          </button>
          <button
            type="button"
            className={`segmented-option${listScope === "personal" ? " active" : ""}`}
            onClick={() => setListScope("personal")}
          >
            Pessoais
          </button>
        </div>

        {listedBills.length > 0 && (
          <div className="stat-card">
            <p className="label">{listScope === "joint" ? "Todo mês, o grupo paga" : "Todo mês, você paga"}</p>
            <p className="value">
              {hasVariable ? "≈ " : ""}
              {formatCurrency(monthlyTotal)}
            </p>
          </div>
        )}

        {bills === null ? null : listedBills.length === 0 ? (
          <EmptyState>
            {listScope === "joint" ? "Nenhuma conta fixa do grupo ainda." : "Nenhuma conta fixa pessoal ainda."}
          </EmptyState>
        ) : (
          <ul className="card bill-list">{listedBills.map(renderBillCard)}</ul>
        )}

        {showForm && (
        <Sheet onClose={() => setShowForm(false)} labelledBy="new-bill-title">
          <h1 id="new-bill-title">Nova conta</h1>
          <form onSubmit={handleCreate}>
            <div className="field">
              <span className="field-label" id="bill-repeat-label">Essa conta se repete?</span>
              <div className="segmented" role="group" aria-labelledby="bill-repeat-label">
                {(
                  [
                    ["once", "Só esta vez"],
                    ["month", "Todo mês"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`segmented-option${repeat === value ? " active" : ""}`}
                    aria-pressed={repeat === value}
                    onClick={() => {
                      setRepeat(value);
                      setError(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="card-subtitle">
                {repeat === "once"
                  ? "Uma conta que vem uma vez só: boleto, multa, mensalidade atrasada. Quando você paga, ela vira um gasto no extrato e não volta no mês seguinte."
                  : "Aluguel e assinaturas lançam sozinhas todo mês. Celular, água e luz, que mudam de valor, o PAR. lembra antes de vencer."}
              </p>
            </div>

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
                placeholder={repeat === "once" ? "Academia, multa, conserto..." : "Aluguel, Netflix, academia..."}
                required
              />
            </div>

            {repeat === "once" ? (
              <>
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
                  <label htmlFor="bill-due-date">Vencimento</label>
                  <input
                    id="bill-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                  <p className="card-subtitle" style={{ marginBottom: 0 }}>
                    {dueDate && dueDate < todayISO()
                      ? "Já venceu. Ela entra como atrasada, e quando você pagar o gasto fica com a data do pagamento."
                      : "Pode ser uma data que já passou."}
                  </p>
                </div>
              </>
            ) : (
            <>
            <div className="field">
              <span className="field-label" id="bill-mode-label">Valor</span>
              <div className="segmented" role="group" aria-labelledby="bill-mode-label">
                {AMOUNT_MODES.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    className={`segmented-option${amountMode === option.mode ? " active" : ""}`}
                    aria-pressed={amountMode === option.mode}
                    onClick={() => setAmountMode(option.mode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="card-subtitle">{AMOUNT_MODES.find((option) => option.mode === amountMode)?.hint}</p>
            </div>

            {amountMode !== "unknown" && (
              <div className="field">
                <label htmlFor="bill-amount">{amountMode === "estimate" ? "Valor estimado (R$)" : "Valor (R$)"}</label>
                <input
                  id="bill-amount"
                  inputMode="decimal"
                  placeholder={amountMode === "estimate" ? "ex: 100,00" : "0,00"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
            )}

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
              <span className="field-label" id="bill-remind-label">Me avisar</span>
              <div className="chip-row bill-remind-chips" role="group" aria-labelledby="bill-remind-label">
                {REMIND_OPTIONS.map((option) => (
                  <button
                    key={option.days}
                    type="button"
                    className={`filter-chip${remindDays === option.days ? " active" : ""}`}
                    aria-pressed={remindDays === option.days}
                    onClick={() => setRemindDays(option.days)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="bill-category">Categoria (opcional)</label>
              <select id="bill-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
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
            </>
            )}

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || (repeat === "month" && !accountForScope)}
            >
              {isSubmitting
                ? "Salvando..."
                : repeat === "month" && amountMode === "fixed"
                ? "Adicionar conta fixa"
                : "Salvar conta"}
            </button>
          </form>
        </Sheet>
        )}
    </>
  );

  if (embedded) return content;
  return (
    <AppLayout>
      <div className="page-stack">
        <BillsTabs />
        {content}
      </div>
    </AppLayout>
  );
}
