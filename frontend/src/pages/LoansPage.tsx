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
import { Sheet } from "../components/Sheet";

interface Repayment {
  id: string;
  amount: string;
  receivedAt: string;
  accountId: string | null;
}

interface Loan {
  id: string;
  // "lent" = me devem (emprestei); "borrowed" = eu devo (peguei emprestado).
  direction?: "lent" | "borrowed";
  personName: string;
  amount: string;
  lentAt: string;
  dueDate: string | null;
  note: string | null;
  accountId: string | null;
  repayments: Repayment[];
  status: "open" | "paid" | "forgiven";
  received: string;
  interest: string;
  totalOwed: string;
  interestRateMonthly: number | null;
  remaining: string;
  remainingAtDue: string | null;
  isOverdue: boolean;
  ownerUserId: string;
  isMine: boolean;
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
  // "Eu devo", somado à parte.
  owedSummary?: LoansSummary;
  // Contas + guardado em cartões garantidos, igual ao Painel.
  moneyToday?: number;
  // Faturas, parcelas e contas fixas até o último prazo em aberto.
  paymentsAhead?: { dueDate: string; amount: number }[];
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

// "Vence em 5 dias" / "Atrasado há 3 dias" / "Sem prazo" -- o que importa
// bater o olho em cada linha.
type Side = "lent" | "borrowed";

function sideOf(loan: Loan): Side {
  return loan.direction === "borrowed" ? "borrowed" : "lent";
}

function dueLabel(loan: Loan): { text: string; tone: "bad" | "warn" | "muted" | "good" } {
  if (loan.status === "paid") return { text: sideOf(loan) === "borrowed" ? "Pago" : "Recebido", tone: "good" };
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
  const [members, setMembers] = useState<{ id: string; displayName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // O atalho "Emprestei" do Painel abre isso com ?novo=1.
  const [isCreateOpen, setIsCreateOpen] = useState(() => new URLSearchParams(window.location.search).get("novo") === "1");
  const [receiving, setReceiving] = useState<Loan | null>(null);
  const [editing, setEditing] = useState<Loan | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  // Me devem / Eu devo. O atalho do Painel abre "Eu devo" com ?lado=devo.
  const [side, setSide] = useState<Side>(() =>
    new URLSearchParams(window.location.search).get("lado") === "devo" ? "borrowed" : "lent"
  );

  async function load() {
    try {
      const [loans, group] = await Promise.all([
        apiRequest<LoansResponse>("/loans", { token }),
        apiRequest<{ accounts: AccountRow[]; members: { id: string; displayName: string }[] }>("/groups/me", { token }),
      ]);
      setData(loans);
      setAccounts(group.accounts);
      setMembers(group.members);
      writeCache(cacheKey, loans);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os empréstimos");
    }
  }

  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const inAccounts = data?.moneyToday ?? accounts.reduce((sum, account) => sum + account.balance, 0);
  const outstanding = Number(data?.summary.outstanding ?? 0);
  const owed = Number(data?.owedSummary?.outstanding ?? 0);
  const sideSummary = side === "lent" ? data?.summary : data?.owedSummary;
  const openLoans = useMemo(
    () => (data?.loans ?? []).filter((loan) => loan.status === "open" && sideOf(loan) === side),
    [data, side]
  );
  const finishedLoans = useMemo(
    () => (data?.loans ?? []).filter((loan) => loan.status !== "open" && sideOf(loan) === side),
    [data, side]
  );
  const openCount = (which: Side) => (data?.loans ?? []).filter((loan) => loan.status === "open" && sideOf(loan) === which).length;
  const owe = side === "borrowed";
  const personalAccount = accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id);

  // "Quando pagar, você fica com R$ X": o saldo subindo empréstimo por
  // empréstimo na ordem em que devem voltar (a lista já vem nessa ordem:
  // atrasados primeiro, depois por prazo, sem prazo por último), já tirando
  // as faturas, parcelas e contas fixas que vencem até cada prazo. Com juros,
  // soma o que vai estar devendo no dia do prazo.
  const balanceAfter = useMemo(() => {
    const map = new Map<string, { value: number; paidBefore: number }>();
    const payments = data?.paymentsAhead ?? [];
    let running = inAccounts;
    let next = 0;
    let paidBefore = 0;
    for (const loan of openLoans) {
      if (loan.dueDate) {
        while (next < payments.length && payments[next].dueDate <= loan.dueDate) {
          running -= payments[next].amount;
          paidBefore += payments[next].amount;
          next += 1;
        }
      }
      running += Number(loan.remainingAtDue ?? loan.remaining);
      map.set(loan.id, { value: running, paidBefore });
    }
    return map;
  }, [openLoans, inAccounts, data]);

  function replaceLoan(updated: Loan) {
    void load();
    setData((prev) =>
      prev ? { ...prev, loans: prev.loans.map((loan) => (loan.id === updated.id ? updated : loan)) } : prev
    );
  }

  async function handleForgive(loan: Loan) {
    const ok = await confirm({
      title: sideOf(loan) === "borrowed" ? `${loan.personName} te perdoou?` : `Perdoar ${loan.personName}?`,
      body:
        sideOf(loan) === "borrowed"
          ? `Os ${formatCurrency(Number(loan.remaining))} que faltam saem do "eu devo". Dá pra reabrir depois.`
          : `Os ${formatCurrency(Number(loan.remaining))} que faltam saem do "me devem". Dá pra reabrir depois.`,
      confirmLabel: sideOf(loan) === "borrowed" ? "Me perdoou" : "Perdoar",
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
        ? sideOf(loan) === "borrowed"
          ? "A entrada e os pagamentos somem do extrato e o saldo da conta volta a ser como antes."
          : "O valor volta pro saldo da conta como se nunca tivesse saído, e os recebimentos somem do extrato."
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
      title: sideOf(loan) === "borrowed" ? "Desfazer esse pagamento?" : "Desfazer esse recebimento?",
      body: `${formatCurrency(Number(repayment.amount))} de ${shortDate(repayment.receivedAt)} volta a ficar em aberto.`,
      confirmLabel: "Desfazer",
    });
    if (!ok) return;
    try {
      replaceLoan(await apiRequest<Loan>(`/loans/${loan.id}/repayments/${repayment.id}`, { method: "DELETE", token }));
      showToast(sideOf(loan) === "borrowed" ? "Pagamento desfeito" : "Recebimento desfeito", { variant: "info" });
    } catch (err) {
      showToast("Não deu pra desfazer", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  function renderLoan(loan: Loan) {
    const due = dueLabel(loan);
    const total = Number(loan.totalOwed ?? loan.amount);
    const received = Number(loan.received);
    const interest = Number(loan.interest ?? 0);
    const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
    const isExpanded = expandedId === loan.id;
    const after = balanceAfter.get(loan.id);
    const atDue = loan.remainingAtDue ? Number(loan.remainingAtDue) : null;
    const ownerName = members.find((m) => m.id === loan.ownerUserId)?.displayName?.split(" ")[0] ?? "a outra pessoa";
    const iOwe = sideOf(loan) === "borrowed";
    const verb = iOwe ? "Paguei" : "Recebi";
    return (
      <li key={loan.id} className={`loan-row${loan.isOverdue ? " is-overdue" : ""}${loan.status !== "open" ? " is-done" : ""}`}>
        <div className="loan-row-head">
        <button
          type="button"
          className="loan-row-main"
          onClick={() => setExpandedId(isExpanded ? null : loan.id)}
          aria-expanded={isExpanded}
        >
          <span className={`loan-avatar${iOwe ? " is-owe" : ""}`} aria-hidden="true">
            {loan.personName.charAt(0).toUpperCase()}
          </span>
          <span className="loan-info">
            <span className="loan-name text-truncate">{loan.personName}</span>
            <span className={`loan-due tone-${due.tone}`}>{due.text}</span>
          </span>
          <span className="loan-amounts">
            <strong>{formatCurrency(Number(loan.status === "open" ? loan.remaining : loan.amount))}</strong>
            {loan.status === "open" && (received > 0 || interest > 0) && (
              <small>
                {interest > 0 ? `com ${formatCurrency(interest)} de juros` : `de ${formatCurrency(total)}`}
              </small>
            )}
          </span>
        </button>
        {loan.status === "open" && loan.isMine && (
          <button type="button" className="btn btn-primary btn-sm loan-receive" onClick={() => setReceiving(loan)}>
            {verb}
          </button>
        )}
        </div>
        {loan.status === "open" && received > 0 && (
          <div className="progress-track thin loan-progress">
            <div className={`progress-fill${iOwe ? " is-owe" : ""}`} style={{ width: `${percent}%` }} />
          </div>
        )}
        {!iOwe && loan.status === "open" && after && accounts.length > 0 && (
          <p className="loan-projection">
            <Icon name="trend" />
            <span>
              Quando {loan.dueDate ? "pagar" : "receber"}, você fica com <strong>{formatCurrency(after.value)}</strong>
              {after.paidBefore > 0 && (
                <span className="loan-projection-note"> já tirando {formatCurrency(after.paidBefore)} de contas até lá</span>
              )}
            </span>
          </p>
        )}
        {loan.status === "open" && atDue !== null && loan.dueDate && (
          <p className="loan-projection loan-projection-note">
            No prazo ({shortDate(loan.dueDate)}), com juros: <strong>{formatCurrency(atDue)}</strong>
          </p>
        )}
        {!loan.isMine && (
          <p className="loan-projection loan-projection-note">
            Registrado por {ownerName}. {iOwe ? "Entrou na Nossa Conta." : "Saiu da Nossa Conta."}
          </p>
        )}

        {isExpanded && (
          <div className="loan-details">
            <p className="loan-detail-line">
              {iOwe ? "Pegou emprestado em" : "Emprestado em"} {shortDate(loan.lentAt)}
              {loan.dueDate ? ` · prazo ${shortDate(loan.dueDate)}` : " · sem prazo"}
            </p>
            {loan.interestRateMonthly && (
              <p className="loan-detail-line">
                Juros de {String(loan.interestRateMonthly).replace(".", ",")}% ao mês: {formatCurrency(interest)} até hoje
                ({iOwe ? "pegou" : "emprestou"} {formatCurrency(Number(loan.amount))}).
              </p>
            )}
            {loan.note && <p className="loan-detail-line">{loan.note}</p>}
            {loan.repayments.length > 0 && (
              <ul className="loan-repayments">
                {loan.repayments.map((repayment) => (
                  <li key={repayment.id}>
                    <span>
                      {iOwe ? "Pagou" : "Recebeu"} {formatCurrency(Number(repayment.amount))} · {shortDate(repayment.receivedAt)}
                    </span>
                    <button type="button" className="link-button" onClick={() => handleUndoRepayment(loan, repayment)}>
                      Desfazer
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {loan.isMine && (
            <div className="loan-actions">
              {loan.status === "open" ? (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setReceiving(loan)}>
                    {verb}
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(loan)}>
                    Editar
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => handleForgive(loan)}>
                    {iOwe ? "Me perdoou" : "Perdoar"}
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
            )}
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
            <h1>Empréstimos</h1>
            <p className="card-subtitle">
              {owe ? "Dinheiro que você pegou emprestado e vai devolver." : "Dinheiro que você emprestou e ainda vai voltar."}
            </p>
          </div>
          <button
            type="button"
            className={`btn btn-sm ${owe ? "btn-owe" : "btn-primary"}`}
            style={{ width: "auto" }}
            onClick={() => setIsCreateOpen(true)}
          >
            {owe ? "+ Peguei emprestado" : "+ Emprestei"}
          </button>
        </div>

        <div className="segmented loans-sides" role="tablist" aria-label="Lado">
          {(["lent", "borrowed"] as const).map((which) => (
            <button
              key={which}
              type="button"
              role="tab"
              aria-selected={side === which}
              className={`segmented-option${side === which ? " active" : ""}`}
              onClick={() => {
                setSide(which);
                setExpandedId(null);
              }}
            >
              {which === "lent" ? "Me devem" : "Eu devo"}
              {data && <span className="loans-side-count">{openCount(which)}</span>}
            </button>
          ))}
        </div>

        {error && <p className="alert">{error}</p>}

        <div className="card loans-hero">
          <div className="loans-hero-row">
            <span className="loans-hero-label">Seu dinheiro hoje</span>
            <span className="loans-hero-value">{formatCurrency(inAccounts)}</span>
          </div>
          <div className="loans-hero-row">
            <span className="loans-hero-label">+ Vão te pagar</span>
            <span className="loans-hero-value accent">{formatCurrency(outstanding)}</span>
          </div>
          <div className="loans-hero-row">
            <span className="loans-hero-label">− Você deve</span>
            <span className="loans-hero-value owe">{formatCurrency(owed)}</span>
          </div>
          <div className="loans-hero-divider" />
          <div className="loans-hero-row total">
            <span className="loans-hero-label">Seu de verdade</span>
            <span className="loans-hero-total">{formatCurrency(inAccounts + outstanding - owed)}</span>
          </div>
          {sideSummary && sideSummary.openCount > 0 && (
            <div className="loans-chips">
              {sideSummary.overdueCount > 0 && (
                <span className="loans-chip bad">Atrasado {formatCurrency(Number(sideSummary.overdue))}</span>
              )}
              {Number(sideSummary.dueSoon) > 0 && (
                <span className="loans-chip warn">Próx. 30 dias {formatCurrency(Number(sideSummary.dueSoon))}</span>
              )}
              {Number(sideSummary.noDueDate) > 0 && (
                <span className="loans-chip">Sem prazo {formatCurrency(Number(sideSummary.noDueDate))}</span>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <p className="card-title">{owe ? "Você deve pra" : "Te devem"}</p>
          {data && openLoans.length === 0 ? (
            <div className="loans-empty">
              <p>{owe ? "Você não deve nada pra ninguém agora." : "Ninguém te deve nada agora."}</p>
              <p className="field-hint">
                {owe
                  ? "Pegou dinheiro emprestado com alguém? Registre aqui: entra na conta sem contar como renda, e cada pagamento sai sem contar como gasto."
                  : "Emprestou pra alguém? Registre aqui e o PAR. mostra quanto você vai ter quando receber, com ou sem prazo."}
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
          direction={side}
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
  direction,
  accounts,
  defaultAccountId,
  onClose,
  onCreated,
}: {
  direction: Side;
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
  const [hasInterest, setHasInterest] = useState(false);
  const [interestRate, setInterestRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseAmount(amount);
    const rate = hasInterest ? Number(interestRate.replace(",", ".")) : null;
    const owe = direction === "borrowed";
    if (!personName.trim()) return setError(owe ? "Quem te emprestou?" : "Pra quem você emprestou?");
    if (rate !== null && !(rate > 0 && rate <= 20)) return setError("Juros entre 0,1% e 20% ao mês.");
    if (!(parsed > 0)) return setError("Informe um valor válido.");
    if (hasDueDate && !dueDate) return setError("Escolha o prazo ou desmarque \"Tem prazo\".");
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest("/loans", {
        method: "POST",
        token,
        body: {
          direction,
          personName: personName.trim(),
          amount: parsed,
          lentAt,
          dueDate: hasDueDate ? dueDate : null,
          note: note.trim() || null,
          accountId: accountId || null,
          interestRateMonthly: rate,
        },
      });
      showToast("Empréstimo registrado", {
        description: !accountId
          ? "Nenhuma conta foi alterada"
          : owe
            ? "Entrou na conta sem contar como renda"
            : "Saiu da conta sem contar como gasto",
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  const owe = direction === "borrowed";
  return (
    <Sheet onClose={onClose}>
      <h1>{owe ? "Peguei emprestado" : "Emprestei dinheiro"}</h1>
      <p className="card-subtitle">
        {owe ? "Não conta como renda. É de outra pessoa e vai voltar pra ela." : "Não conta como gasto. É seu e vai voltar."}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="loan-person">{owe ? "De quem" : "Pra quem"}</label>
          <input
            id="loan-person"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            placeholder={owe ? "Pai, Carlos do trabalho..." : "Mãe, João, Tia Rita..."}
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
            <label htmlFor="loan-due">{owe ? "Devolvo até" : "Devolve até"}</label>
            <input id="loan-due" type="date" min={lentAt} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        )}
        <label className="checkbox-field">
          <input type="checkbox" checked={hasInterest} onChange={(e) => setHasInterest(e.target.checked)} />
          <span>{owe ? "Tem juros" : "Cobrar juros"}</span>
        </label>
        {hasInterest && (
          <div className="field">
            <label htmlFor="loan-interest">Juros (% ao mês)</label>
            <input
              id="loan-interest"
              inputMode="decimal"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
              placeholder="2"
            />
            <p className="field-hint">Juros simples, contados a cada mês cheio desde o empréstimo.</p>
          </div>
        )}
        <div className="field">
          <label htmlFor="loan-account">{owe ? "Entrou em qual conta" : "Saiu de qual conta"}</label>
          <AccountSelect
            id="loan-account"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            noneLabel={owe ? "Não entrou em conta (dinheiro vivo ou antes)" : "Não tirar de conta (já saiu antes)"}
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
    </Sheet>
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
  // "Recebeu tudo" é o caso comum; "Só uma parte" abre o campo de valor.
  const [isPartial, setIsPartial] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(todayISO());
  const [accountId, setAccountId] = useState(defaultAccountId);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = isPartial ? parseAmount(amount) : remaining;
    if (!(parsed > 0)) return setError("Informe um valor válido.");
    if (parsed > remaining) return setError(`Falta só ${formatCurrency(remaining)}.`);
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await apiRequest<Loan>(`/loans/${loan.id}/repayments`, {
        method: "POST",
        token,
        body: { amount: parsed, receivedAt, accountId: accountId || null },
      });
      const iOwe = sideOf(loan) === "borrowed";
      showToast(
        updated.status === "paid"
          ? iOwe
            ? `Você quitou ${loan.personName}`
            : `${loan.personName} quitou tudo`
          : iOwe
            ? "Pagamento anotado"
            : "Recebimento anotado",
        { description: updated.status === "paid" ? undefined : `Falta ${formatCurrency(Number(updated.remaining))}` }
      );
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  const iOwe = sideOf(loan) === "borrowed";
  return (
    <Sheet onClose={onClose}>
      <h1>{iOwe ? `Paguei ${loan.personName}` : `Recebi de ${loan.personName}`}</h1>
      <p className="card-subtitle">
        Falta {formatCurrency(remaining)}. {iOwe ? "Não entra como gasto: você está devolvendo." : "Não entra como renda: o dinheiro já era seu."}
      </p>
      <form onSubmit={handleSubmit}>
        <div className="segmented" role="radiogroup" aria-label={iOwe ? "Quanto pagou" : "Quanto recebeu"}>
          <button type="button" role="radio" aria-checked={!isPartial} className={`segmented-option${!isPartial ? " active" : ""}`} onClick={() => setIsPartial(false)}>
            {iOwe ? "Paguei tudo" : "Recebeu tudo"}
          </button>
          <button type="button" role="radio" aria-checked={isPartial} className={`segmented-option${isPartial ? " active" : ""}`} onClick={() => setIsPartial(true)}>
            Só uma parte
          </button>
        </div>
        <div className="field-row">
          {isPartial && (
            <div className="field">
              <label htmlFor="repay-amount">Valor (R$)</label>
              <input id="repay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" autoFocus />
            </div>
          )}
          <div className="field">
            <label htmlFor="repay-date">Quando</label>
            <input id="repay-date" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="repay-account">{iOwe ? "Saiu de qual conta" : "Entrou em qual conta"}</label>
          <AccountSelect
            id="repay-account"
            accounts={accounts}
            value={accountId}
            onChange={setAccountId}
            noneLabel={iOwe ? "Não saiu de conta (dinheiro vivo)" : "Não entrou em conta (dinheiro vivo)"}
          />
        </div>
        {error && <p className="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Salvando..." : isPartial ? "Salvar" : `${iOwe ? "Paguei" : "Recebi"} ${formatCurrency(remaining)}`}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

function EditLoanModal({ loan, onClose, onSaved }: { loan: Loan; onClose: () => void; onSaved: (loan: Loan) => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [personName, setPersonName] = useState(loan.personName);
  const [hasDueDate, setHasDueDate] = useState(loan.dueDate !== null);
  const [dueDate, setDueDate] = useState(loan.dueDate ?? "");
  const [note, setNote] = useState(loan.note ?? "");
  const [hasInterest, setHasInterest] = useState(Boolean(loan.interestRateMonthly));
  const [interestRate, setInterestRate] = useState(loan.interestRateMonthly ? String(loan.interestRateMonthly).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!personName.trim()) return setError("Informe o nome.");
    const rate = hasInterest ? Number(interestRate.replace(",", ".")) : null;
    if (rate !== null && !(rate > 0 && rate <= 20)) return setError("Juros entre 0,1% e 20% ao mês.");
    if (hasDueDate && !dueDate) return setError("Escolha o prazo ou desmarque \"Tem prazo\".");
    setError(null);
    setIsSubmitting(true);
    try {
      const updated = await apiRequest<Loan>(`/loans/${loan.id}`, {
        method: "PATCH",
        token,
        body: {
          personName: personName.trim(),
          dueDate: hasDueDate ? dueDate : null,
          note: note.trim() || null,
          interestRateMonthly: rate,
        },
      });
      showToast("Empréstimo atualizado");
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar");
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h1>Editar empréstimo</h1>
      <p className="card-subtitle">
        {formatCurrency(Number(loan.amount))} {sideOf(loan) === "borrowed" ? "pegos emprestados" : "emprestados"} em {shortDate(loan.lentAt)}.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="edit-loan-person">{sideOf(loan) === "borrowed" ? "De quem" : "Pra quem"}</label>
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
        <label className="checkbox-field">
          <input type="checkbox" checked={hasInterest} onChange={(e) => setHasInterest(e.target.checked)} />
          <span>Cobrar juros</span>
        </label>
        {hasInterest && (
          <div className="field">
            <label htmlFor="edit-loan-interest">Juros (% ao mês)</label>
            <input id="edit-loan-interest" inputMode="decimal" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} />
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
    </Sheet>
  );
}
