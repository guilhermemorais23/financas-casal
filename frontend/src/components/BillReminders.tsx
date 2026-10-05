import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency, parseLocalDate, todayISO } from "../utils/format";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";

// Contas fixas sem valor certo (celular, água, luz): o PAR. avisa uns dias
// antes e a pessoa diz quanto foi ("Já paguei") ou pede pra lembrar depois.
// Backend: GET /recurring-bills/reminders, POST /:id/pay e /:id/snooze.
export interface BillReminder {
  billId: string;
  title: string;
  month: string;
  dueDate: string;
  daysUntil: number;
  amountMode: "estimate" | "unknown";
  expectedAmount: number | null;
  lastPaidAmount: number | null;
  snoozed?: boolean;
}

// "54,90", "1.234,56" ou "54.90" -> número.
export function parseMoney(value: string): number {
  const clean = value.trim().replace(/\s|R\$/g, "");
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  return Number(normalized);
}

function moneyInput(value: number | null): string {
  return value === null ? "" : value.toFixed(2).replace(".", ",");
}

export function billDueText(daysUntil: number, dueDate: string): string {
  const day = parseLocalDate(dueDate).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric" });
  if (daysUntil < 0) return `Venceu há ${-daysUntil} ${daysUntil === -1 ? "dia" : "dias"} (${day})`;
  if (daysUntil === 0) return "Vence hoje";
  if (daysUntil === 1) return "Vence amanhã";
  return `Vence em ${daysUntil} dias (${day})`;
}

function amountText(reminder: BillReminder): string {
  if (reminder.amountMode === "estimate" && reminder.expectedAmount !== null) return `≈ ${formatCurrency(reminder.expectedAmount)}`;
  return "valor ainda não informado";
}

// ---------------------------------------------------------------------------
// "Já paguei"
// ---------------------------------------------------------------------------

export function PayBillSheet({
  reminder,
  onClose,
  onDone,
}: {
  reminder: BillReminder;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [amount, setAmount] = useState(moneyInput(reminder.amountMode === "estimate" ? reminder.expectedAmount : null));
  const [paidOn, setPaidOn] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const value = parseMoney(amount);
  const reference = reminder.amountMode === "estimate" ? reminder.expectedAmount : reminder.lastPaidAmount;
  const diff = value > 0 && reference !== null ? Math.round((value - reference) * 100) / 100 : 0;
  const referenceLabel = reminder.amountMode === "estimate" ? "a estimativa" : "no mês passado";

  async function send(body: Record<string, unknown>, successMessage: string) {
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest(`/recurring-bills/${reminder.billId}/pay`, { method: "POST", token, body: { month: reminder.month, ...body } });
      showToast(successMessage, { variant: "success" });
      onDone();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_paid") {
        showToast("Essa conta já estava paga", { variant: "info" });
        onDone();
        onClose();
        return;
      }
      setError(err instanceof ApiError ? err.message : "Não deu pra salvar. Tente de novo.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!(value > 0)) {
      setError("Digite quanto foi a conta.");
      return;
    }
    void send({ amount: value, occurredAt: paidOn }, `${reminder.title}: ${formatCurrency(value)} lançado`);
  }

  return (
    <Sheet onClose={onClose} labelledBy="pay-bill-title">
      <h1 id="pay-bill-title">Quanto foi {reminder.title.toLowerCase().startsWith("conta") ? "a" : "o"} {reminder.title}?</h1>
      <p className="card-subtitle">{billDueText(reminder.daysUntil, reminder.dueDate)}</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="pay-bill-amount">Valor pago (R$)</label>
          <input
            id="pay-bill-amount"
            inputMode="decimal"
            placeholder="0,00"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        {reminder.lastPaidAmount !== null && (
          <div className="chip-row">
            <button type="button" className="filter-chip" onClick={() => setAmount(moneyInput(reminder.lastPaidAmount))}>
              {formatCurrency(reminder.lastPaidAmount)} no mês passado
            </button>
          </div>
        )}
        {diff !== 0 && (
          <p className={`bill-diff ${diff > 0 ? "up" : "down"}`}>
            {diff > 0
              ? `${formatCurrency(diff)} a mais que ${referenceLabel}.`
              : `${formatCurrency(-diff)} a menos que ${referenceLabel}.`}
          </p>
        )}
        <div className="field">
          <label htmlFor="pay-bill-date">Pago em</label>
          <input id="pay-bill-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-outline"
            disabled={isSubmitting}
            onClick={() => void send({ markOnly: true }, `${reminder.title}: marcada como paga`)}
          >
            Já lancei no extrato
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Lançar no extrato"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// "Me lembre mais tarde"
// ---------------------------------------------------------------------------

export function SnoozeBillSheet({
  reminder,
  onClose,
  onDone,
}: {
  reminder: BillReminder;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function snooze(until: "tomorrow" | "due" | "salary", label: string) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/recurring-bills/${reminder.billId}/snooze`, { method: "POST", token, body: { until } });
      showToast(`Combinado, lembro ${label}`, { variant: "info" });
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra adiar. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  const dueLater = reminder.daysUntil > 1;
  return (
    <Sheet onClose={onClose} labelledBy="snooze-bill-title">
      <h1 id="snooze-bill-title">Lembrar quando?</h1>
      <p className="card-subtitle">{reminder.title}</p>
      <div className="bill-snooze-options">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void snooze("tomorrow", "amanhã")}>
          Amanhã
        </button>
        {dueLater && (
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void snooze("due", "no dia do vencimento")}>
            No dia do vencimento
          </button>
        )}
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void snooze("salary", "quando o salário cair")}>
          Quando o salário cair
        </button>
      </div>
      <p className="card-subtitle">“Quando o salário cair” volta a avisar quando entrar uma receita na sua conta (ou em 15 dias).</p>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Aviso no Painel
// ---------------------------------------------------------------------------

export function BillRemindersCard({ onChanged }: { onChanged: () => void }) {
  const { token } = useAuth();
  const [reminders, setReminders] = useState<BillReminder[]>([]);
  const [paying, setPaying] = useState<BillReminder | null>(null);
  const [snoozing, setSnoozing] = useState<BillReminder | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(async () => {
    try {
      setReminders(await apiRequest<BillReminder[]>("/recurring-bills/reminders", { token }));
    } catch {
      // Aviso é extra: sem ele o Painel funciona igual.
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // Veio da notificação: /dashboard?conta=<id>&acao=pagar|adiar.
  useEffect(() => {
    const billId = searchParams.get("conta");
    if (!billId) return;
    const action = searchParams.get("acao");
    let cancelled = false;
    void (async () => {
      const all = await apiRequest<BillReminder[]>("/recurring-bills/reminders?all=1", { token }).catch(() => []);
      if (cancelled) return;
      const target = all.find((r) => r.billId === billId);
      if (target) {
        if (action === "adiar") setSnoozing(target);
        else setPaying(target);
      }
      const next = new URLSearchParams(searchParams);
      next.delete("conta");
      next.delete("acao");
      setSearchParams(next, { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setSearchParams, token]);

  function done() {
    void load();
    onChanged();
  }

  return (
    <>
      {reminders.length > 0 && (
        <div className="bill-reminders" aria-label="Contas pra pagar">
          {reminders.map((reminder) => (
            <div key={reminder.billId} className={`bill-reminder${reminder.daysUntil < 0 ? " late" : ""}`}>
              <div className="bill-reminder-top">
                <span className="dashboard-nudge-icon warn" aria-hidden="true">
                  <Icon name="alert" />
                </span>
                <span className="dashboard-nudge-text">
                  <strong>
                    {reminder.title}{" "}
                    {reminder.daysUntil < 0
                      ? "está atrasada"
                      : reminder.daysUntil === 0
                      ? "vence hoje"
                      : reminder.daysUntil === 1
                      ? "vence amanhã"
                      : `vence em ${reminder.daysUntil} dias`}
                  </strong>
                  <small>
                    {parseLocalDate(reminder.dueDate).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric" })} · {amountText(reminder)}
                  </small>
                </span>
              </div>
              <div className="bill-reminder-actions">
                <button type="button" className="btn btn-primary" onClick={() => setPaying(reminder)}>
                  Já paguei
                </button>
                <button type="button" className="btn btn-outline" onClick={() => setSnoozing(reminder)}>
                  Me lembre mais tarde
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {paying && <PayBillSheet reminder={paying} onClose={() => setPaying(null)} onDone={done} />}
      {snoozing && <SnoozeBillSheet reminder={snoozing} onClose={() => setSnoozing(null)} onDone={done} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// "Contas do mês": anotar os valores de tudo de uma vez (dia do salário)
// ---------------------------------------------------------------------------

export function MonthBillsCard({ onChanged }: { onChanged: () => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [bills, setBills] = useState<BillReminder[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await apiRequest<BillReminder[]>("/recurring-bills/reminders?all=1", { token });
      setBills(list);
      setValues(Object.fromEntries(list.map((b) => [b.billId, moneyInput(b.amountMode === "estimate" ? b.expectedAmount : null)])));
    } catch {
      setBills([]);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!bills || bills.length === 0) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const filled = (bills ?? []).filter((b) => parseMoney(values[b.billId] ?? "") > 0);
    if (filled.length === 0) {
      setError("Preencha o valor de pelo menos uma conta.");
      return;
    }
    setBusy(true);
    setError(null);
    let saved = 0;
    for (const bill of filled) {
      try {
        await apiRequest(`/recurring-bills/${bill.billId}/pay`, {
          method: "POST",
          token,
          body: { month: bill.month, amount: parseMoney(values[bill.billId]) },
        });
        saved++;
      } catch (err) {
        if (!(err instanceof ApiError && err.code === "already_paid")) {
          setError(`Não deu pra lançar ${bill.title}. As outras foram salvas.`);
        }
      }
    }
    setBusy(false);
    if (saved > 0) showToast(`${saved} ${saved === 1 ? "conta lançada" : "contas lançadas"} no extrato`, { variant: "success" });
    await load();
    onChanged();
  }

  return (
    <form className="card month-bills" onSubmit={handleSubmit}>
      <p className="card-title">Contas do mês</p>
      <p className="card-subtitle">
        {bills.length === 1 ? "Falta o valor de 1 conta." : `Falta o valor de ${bills.length} contas.`} Anote o que veio em
        cada uma e lance tudo de uma vez.
      </p>
      <ul className="month-bills-list">
        {bills.map((bill) => (
          <li key={bill.billId} className="month-bills-row">
            <label htmlFor={`month-bill-${bill.billId}`} className="month-bills-name">
              <strong>{bill.title}</strong>
              <small>
                {billDueText(bill.daysUntil, bill.dueDate)}
                {bill.amountMode === "estimate" && bill.expectedAmount !== null ? ` · estimativa ${formatCurrency(bill.expectedAmount)}` : ""}
              </small>
            </label>
            <input
              id={`month-bill-${bill.billId}`}
              inputMode="decimal"
              placeholder={bill.lastPaidAmount !== null ? moneyInput(bill.lastPaidAmount) : "0,00"}
              value={values[bill.billId] ?? ""}
              onChange={(e) => setValues((current) => ({ ...current, [bill.billId]: e.target.value }))}
            />
          </li>
        ))}
      </ul>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Lançando..." : "Lançar os valores"}
      </button>
    </form>
  );
}
