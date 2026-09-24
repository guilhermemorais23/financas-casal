import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BillsTabs } from "../components/BillsTabs";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency, parseLocalDate } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface Repayment {
  id: string;
  amount: string;
  receivedAt: string;
  accountId: string | null;
}

interface Loan {
  id: string;
  personName: string;
  amount: string;
  lentAt: string;
  dueDate: string | null;
  note: string | null;
  accountId: string | null;
  repayments: Repayment[];
  status: "open" | "paid" | "forgiven";
  received: string;
  remaining: string;
  isOverdue: boolean;
}

interface LoansSummary {
  outstanding: string;
  overdue: string;
  overdueCount: number;
  dueSoon: string;
  noDueDate: string;
  openCount: number;
}

interface LoansResponse {
  loans: Loan[];
  summary: LoansSummary;
}

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  ownerUserId: string | null;
  balance: number;
}

const NO_ACCOUNT = "";

function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function shortDate(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseLocalDate(toIso).getTime() - parseLocalDate(fromIso).getTime()) / 86_400_000);
}

// "Vence em 5 dias" / "Atrasado há 3 dias" / "Sem prazo" -- what matters at
// a glance on each row.
function dueLabel(loan: Loan): { text: string; tone: "bad" | "warn" | "muted" | "good" } {
  if (loan.status === "paid") return { text: "Recebido", tone: "good" };
  if (loan.status === "forgiven") return { text: "Perdoado", tone: "muted" };
  if (!loan.dueDate) return { text: "Sem prazo", tone: "muted" };
  const days = daysBetween(todayISO(), loan.dueDate);
  if (days < 0) return { text: `Atrasado há ${-days} ${-days === 1 ? "dia" : "dias"}`, tone: "bad" };
  if (days === 0) return { text: "Vence hoje", tone: "warn" };
  if (days <= 7) return { text: `Vence em ${days} ${days === 1 ? "dia" : "dias"}`, tone: "warn" };
  return { text: `Vence ${shortDate(loan.dueDate)}`, tone: "muted" };
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/\./g, "").replace(",", "."));
}

export function LoansPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const cacheKey = `loans:${user?.id}`;
  const [data, setData] = useState<LoansResponse | null>(() => readCache<LoansResponse>(cacheKey));
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [receiving, setReceiving] = useState<Loan | null>(null);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  async function load() {
    try {
      const [loans, group] = await Promise.all([
        apiRequest<LoansResponse>("/loans", { token }),
        apiRequest<{ accounts: AccountRow[] }>("/groups/me", { token }),
      ]);
      setData(loans);
      setAccounts(group.accounts);
      writeCache(cacheKey, loans);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os empréstimos");
    }
  }

  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const inAccounts = accounts.reduce((sum, account) => sum + account.balance, 0);
  const outstanding = Number(data?.summary.outstanding ?? 0);
  const openLoans = useMemo(() => (data?.loans ?? []).filter((loan) => loan.status === "open"), [data]);
  const finishedLoans = useMemo(() => (data?.loans ?? []).filter((loan) => loan.status !== "open"), [data]);
  const personalAccount = accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id);

  function replaceLoan(updated: Loan) {
    void load();
    setData((prev) =>
      prev ? { ...prev, loans: prev.loans.map((loan) => (loan.id === updated.id ? updated : loan)) } : prev
    );
  }

  async function handleForgive(loan: Loan) {
    const ok = await confirm({
      title: `Perdoar ${loan.personName}?`,
      body: `Os ${formatCurrency(Number(loan.remaining))} que faltam saem do "a receber". Dá pra reabrir depois.`,
      confirmLabel: "Perdoar",
      tone: "primary",
    });
    if (!ok) return;
    try {
      replaceLoan(await apiRequest<Loan>(`/loans/${loan.id}`, { method: "PATCH", token, body: { status: "forgiven" } }));
      showToast("Empréstimo perdoado", { variant: "info" });
    } catch (err) {
      showToast("Não deu pra perdoar", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  async function handleReopen(loan: Loan) {
    try {
      replaceLoan(await apiRequest<Loan>(`/loans/${loan.id}`, { method: "PATCH", token, body: { status: "open" } }));
      showToast("Empréstimo reaberto", { variant: "info" });
    } catch (err) {
      showToast("Não deu pra reabrir", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  async function handleDelete(loan: Loan) {
    const ok = await confirm({
      title: "Excluir esse empréstimo?",
      body: loan.accountId
        ? "O valor volta pro saldo da conta como se nunca tivesse saído, e os recebimentos somem do extrato."
        : "Ele some da lista. Nenhuma conta é alterada.",
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    try {
      await apiRequest(`/loans/${loan.id}`, { method: "DELETE", token });
      showToast("Empréstimo excluído");
      void load();
    } catch (err) {
      showToast("Não deu pra excluir", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  async function handleUndoRepayment(loan: Loan, repayment: Repayment) {
    const ok = await confirm({
      title: "Desfazer esse recebimento?",
      body: `${formatCurrency(Number(repayment.amount))} de ${shortDate(repayment.receivedAt)} volta a ficar em aberto.`,
      confirmLabel: "Desfazer",
    });
    if (!ok) return;
    try {
      replaceLoan(await apiRequest<Loan>(`/loans/${loan.id}/repayments/${repayment.id}`, { method: "DELETE", token }));
      showToast("Recebimento desfeito", { variant: "info" });
    } catch (err) {
      showToast("Não deu pra desfazer", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  function renderLoan(loan: Loan) {
    const due = dueLabel(loan);
    const total = Number(loan.amount);
    const received = Number(loan.received);
    const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    const isExpanded = expandedId === loan.id;
    return (
      <li key={loan.id} className={`loan-row${loan.isOverdue ? " is-overdue" : ""}${loan.status !== "open" ? " is-done" : ""}`}>
        <button
          type="button"
          className="loan-row-main"
          onClick={() => setExpandedId(isExpanded ? null : loan.id)}
          aria-expanded={isExpanded}
        >
          <span className="loan-avatar" aria-hidden="true">
            {loan.personName.charAt(0).toUpperCase()}
          </span>
          <span className="loan-info">
            <span className="loan-name text-truncate">{loan.personName}</span>
            <span className={`loan-due tone-${due.tone}`}>{due.text}</span>
          </span>
          <span className="loan-amounts">
            <strong>{formatCurrency(Number(loan.status === "open" ? loan.remaining : loan.amount))}</strong>
            {loan.status === "open" && received > 0 && <small>de {formatCurrency(total)}</small>}
          </span>
        </button>
        {loan.status === "open" && received > 0 && (
          <div className="progress-track thin loan-progress">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        )}

        {isExpanded && (
          <div className="loan-details">
            <p className="loan-detail-line">
              Emprestado em {shortDate(loan.lentAt)}
              {loan.dueDate ? ` · prazo ${shortDate(loan.dueDate)}` : " · sem prazo"}
            </p>
            {loan.note && <p className="loan-detail-line">{loan.note}</p>}
            {loan.repayments.length > 0 && (
              <ul className="loan-repayments">
                {loan.repayments.map((repayment) => (
                  <li key={repayment.id}>
                    <span>Recebeu {formatCurrency(Number(repayment.amount))} · {shortDate(repayment.receivedAt)}</span>
                    <button type="button" className="link-button" onClick={() => handleUndoRepayment(loan, repayment)}>
                      Desfazer
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="loan-actions">
              {loan.status === "open" ? (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReceiving(loan)}>
                    Recebi
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(loan)}>
                    Editar
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => handleForgive(loan)}>
                    Perdoar
                  </button>
                </>
              ) : (
                loan.status === "forgiven" && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => handleReopen(loan)}>
                    Reabrir
                  </button>
                )
              )}
              <button type="button" className="btn-icon" title="Excluir" aria-label="Excluir" onClick={() => handleDelete(loan)}>
                <Icon name="trash" />
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <AppLayout>
      <div className="page-stack">
        <BillsTabs />
        <div className="section-header">
          <div>
            <h1>A receber</h1>
            <p className="card-subtitle">Dinheiro que você emprestou e ainda vai voltar.</p>
          </div>
          <button type="button" className="btn btn-primary btn-sm" style={{ width: "auto" }} onClick={() => setIsCreateOpen(true)}>
            + Emprestei
          </button>
        </div>

        {error && <p className="alert">{error}</p>}

        <div className="card loans-hero">
          <div className="loans-hero-row">
            <span className="loans-hero-label">Na conta hoje</span>
            <span className="loans-hero-value">{formatCurrency(inAccounts)}</span>
          </div>
          <div className="loans-hero-row">
            <span className="loans-hero-label">+ Vão te pagar</span>
            <span className="loans-hero-value accent">{formatCurrency(outstanding)}</span>
          </div>
          <div className="loans-hero-divider" />
          <div className="loans-hero-row total">
            <span className="loans-hero-label">Quando receber tudo</span>
            <span className="loans-hero-total">{formatCurrency(inAccounts + outstanding)}</span>
          </div>
          {data && data.summary.openCount > 0 && (
            <div className="loans-chips">
              {data.summary.overdueCount > 0 && (
                <span className="loans-chip bad">
                  Atrasado {formatCurrency(Number(data.summary.overdue))}
                </span>
              )}
              {Number(data.summary.dueSoon) > 0 && (
                <span className="loans-chip warn">Próx. 30 dias {formatCurrency(Number(data.summary.dueSoon))}</span>
              )}
              {Number(data.summary.noDueDate) > 0 && (
                <span className="loans-chip">Sem prazo {formatCurrency(Number(data.summary.noDueDate))}</span>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <p className="card-title">Em aberto</p>
          {data && openLoans.length === 0 ? (
            <div className="loans-empty">
              <p>Ninguém te deve nada agora.</p>
              <p className="field-hint">
                Emprestou pra alguém? Registre aqui e o PAR. mostra quanto você vai ter quando receber, com ou sem prazo.
              </p>
            </div>
          ) : (
            <ul className="loan-list">{openLoans.map(renderLoan)}</ul>
          )}
        </div>

        {finishedLoans.length > 0 && (
          <div className="card">
            <button type="button" className="report-card-toggle loans-finished-toggle" onClick={() => setShowFinished((v) => !v)}>
              <span className="card-title">Já resolvidos ({finishedLoans.length})</span>
              <span aria-hidden="true">{showFinished ? "▾" : "▸"}</span>
            </button>
            {showFinished && <ul className="loan-list">{finishedLoans.map(renderLoan)}</ul>}
          </div>
        )}
      </div>

      {isCreateOpen && (
        <CreateLoanModal
          accounts={accounts}
          defaultAccountId={personalAccount?.id ?? NO_ACCOUNT}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            void load();
          }}
        />
      )}
      {receiving && (
        <ReceiveModal
          loan={receiving}
          accounts={accounts}
          defaultAccountId={receiving.accountId ?? personalAccount?.id ?? NO_ACCOUNT}
          onClose={() => setReceiving(null)}
          onSaved={(updated) => {
            setReceiving(null);
            replaceLoan(updated);
          }}
        />
      )}
      {editing && (
        <EditLoanModal
          loan={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            replaceLoan(updated);
          }}
        />
      )}
    </AppLayout>
  );
}

function AccountSelect({
  id,
  accounts,
  value,
  onChange,
  noneLabel,
}: {
  id: string;
  accounts: AccountRow[];
  value: string;
  onChange: (value: string) => void;
  noneLabel: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.type === "joint" ? "Nossa Conta" : "Minha conta"} ({formatCurrency(account.balance)})
        </option>
      ))}
      <option value={NO_ACCOUNT}>{noneLabel}</option>
    </select>
  );
}

function CreateLoanModal({
  accounts,
  defaultAccountId,
  onClose,
  onCreated,
}: {
  accounts: AccountRow[];
  defaultAccountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [personName, setPersonName] = useState("");
  const [amount, setAmount] = useState("");
  const [lentAt, setLentAt] = useState(todayISO());
  const [hasDueDate, setHasDueDate] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(amount);
    if (!personName.trim()) return setError("Pra quem você emprestou?");
    if (!(parsed > 0)) return setError("Informe um valor válido.");
    if (hasDueDate && !dueDate) return setError("Escolha o prazo ou desmarque \"Tem prazo\".");
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest("/loans", {
        method: "POST",
        token,
        body: {
          personName: personName.trim(),
          amount: parsed,
          lentAt,
          dueDate: hasDueDate ? dueDate : null,
          note: note.trim() || null,
          accountId: accountId || null,
        },
      });
      showToast("Empréstimo registrado", {
        description: accountId ? "Saiu da conta sem contar como gasto" : "Nenhuma conta foi alterada",
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h1>Emprestei dinheiro</h1>
        <p className="card-subtitle">Não conta como gasto. É seu e vai voltar.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="loan-person">Pra quem</label>
            <input
              id="loan-person"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="Mãe, João, Tia Rita..."
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="loan-amount">Valor (R$)</label>
              <input id="loan-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
            </div>
            <div className="field">
              <label htmlFor="loan-date">Quando</label>
              <input id="loan-date" type="date" value={lentAt} onChange={(e) => setLentAt(e.target.value)} />
            </div>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={hasDueDate} onChange={(e) => setHasDueDate(e.target.checked)} />
            <span>Tem prazo pra devolver</span>
          </label>
          {hasDueDate && (
            <div className="field">
              <label htmlFor="loan-due">Devolve até</label>
              <input id="loan-due" type="date" min={lentAt} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="loan-account">Saiu de qual conta</label>
            <AccountSelect
              id="loan-account"
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              noneLabel="Não tirar de conta (já saiu antes)"
            />
          </div>
          <div className="field">
            <label htmlFor="loan-note">Observação (opcional)</label>
            <input id="loan-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Pro conserto do carro" />
          </div>
          {error && <p className="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReceiveModal({
  loan,
  accounts,
  defaultAccountId,
  onClose,
  onSaved,
}: {
  loan: Loan;
  accounts: AccountRow[];
  defaultAccountId: string;
  onClose: () => void;
  onSaved: (loan: Loan) => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const remaining = Number(loan.remaining);
  const [amount, setAmount] = useState(remaining.toFixed(2).replace(".", ","));
  const [receivedAt, setReceivedAt] = useState(todayISO());
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(amount);
    if (!(parsed > 0)) return setError("Informe um valor válido.");
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await apiRequest<Loan>(`/loans/${loan.id}/repayments`, {
        method: "POST",
        token,
        body: { amount: parsed, receivedAt, accountId: accountId || null },
      });
      showToast(updated.status === "paid" ? `${loan.personName} quitou tudo` : "Recebimento anotado", {
        description: updated.status === "paid" ? undefined : `Falta ${formatCurrency(Number(updated.remaining))}`,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h1>Recebi de {loan.personName}</h1>
        <p className="card-subtitle">Falta {formatCurrency(remaining)}. Pode ser só uma parte.</p>
        <form onSubmit={handleSubmit}>
          <div className="field-row">
            <div className="field">
              <label htmlFor="repay-amount">Valor (R$)</label>
              <input id="repay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="repay-date">Quando</label>
              <input id="repay-date" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="repay-account">Entrou em qual conta</label>
            <AccountSelect
              id="repay-account"
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              noneLabel="Não entrou em conta (dinheiro vivo)"
            />
          </div>
          {error && <p className="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditLoanModal({ loan, onClose, onSaved }: { loan: Loan; onClose: () => void; onSaved: (loan: Loan) => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [personName, setPersonName] = useState(loan.personName);
  const [hasDueDate, setHasDueDate] = useState(loan.dueDate !== null);
  const [dueDate, setDueDate] = useState(loan.dueDate ?? "");
  const [note, setNote] = useState(loan.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!personName.trim()) return setError("Informe o nome.");
    if (hasDueDate && !dueDate) return setError("Escolha o prazo ou desmarque \"Tem prazo\".");
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await apiRequest<Loan>(`/loans/${loan.id}`, {
        method: "PATCH",
        token,
        body: { personName: personName.trim(), dueDate: hasDueDate ? dueDate : null, note: note.trim() || null },
      });
      showToast("Empréstimo atualizado");
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h1>Editar empréstimo</h1>
        <p className="card-subtitle">
          {formatCurrency(Number(loan.amount))} emprestados em {shortDate(loan.lentAt)}.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="edit-loan-person">Pra quem</label>
            <input id="edit-loan-person" value={personName} onChange={(e) => setPersonName(e.target.value)} maxLength={80} />
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={hasDueDate} onChange={(e) => setHasDueDate(e.target.checked)} />
            <span>Tem prazo pra devolver</span>
          </label>
          {hasDueDate && (
            <div className="field">
              <label htmlFor="edit-loan-due">Devolve até</label>
              <input id="edit-loan-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor="edit-loan-note">Observação</label>
            <input id="edit-loan-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          {error && <p className="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
