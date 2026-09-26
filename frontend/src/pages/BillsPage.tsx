import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { BillsTabs } from "../components/BillsTabs";
import { Icon, type IconName } from "../components/Icon";
import { PageSkeleton } from "../components/Skeleton";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { readCache, writeCache } from "../utils/pageCache";
import { formatCurrency, parseLocalDate } from "../utils/format";

type BillKind = "card" | "debt" | "recurring";

interface BillItem {
  id: string;
  kind: BillKind;
  title: string;
  amount: number;
  dueDate: string | null;
  daysUntil: number | null;
  isPaid: boolean;
  pay: { type: "card"; cardId: string; month: string } | { type: "debt"; debtId: string; installmentId: string } | null;
  link: string;
  card?: { closingDay: number; limitFree: number | null };
  debt?: { installmentNumber: number; installmentsCount: number; paidCount: number; remainingAmount: number };
}

interface BillLoan {
  id: string;
  direction: "lent" | "borrowed";
  personName: string;
  remaining: number;
  dueDate: string | null;
  isOverdue: boolean;
}

interface BillsOverview {
  today: string;
  items: BillItem[];
  loans: BillLoan[];
  summary: { toPay: number; overdueCount: number; dueSoonCount: number };
}

type Filter = "all" | BillKind | "loans";

const KIND: Record<BillKind, { label: string; icon: IconName }> = {
  card: { label: "Cartão", icon: "receipt" },
  debt: { label: "Parcelada", icon: "file" },
  recurring: { label: "Conta fixa", icon: "repeat" },
};

const FILTERS: [Filter, string][] = [
  ["all", "Tudo"],
  ["card", "Cartões"],
  ["recurring", "Fixas"],
  ["debt", "Parceladas"],
  ["loans", "Empréstimos"],
];

const shortDate = (iso: string) => parseLocalDate(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

function dueText(item: BillItem): { text: string; tone: "late" | "soon" | "" } {
  if (item.dueDate === null || item.daysUntil === null) return { text: "Sem dia de vencimento", tone: "" };
  const n = item.daysUntil;
  if (n < 0) return { text: `Venceu ${shortDate(item.dueDate)}`, tone: "late" };
  if (n === 0) return { text: "Vence hoje", tone: "soon" };
  if (n === 1) return { text: "Vence amanhã", tone: "soon" };
  if (n <= 7) return { text: `Vence em ${n} dias`, tone: "soon" };
  return { text: `Vence ${shortDate(item.dueDate)}`, tone: "" };
}

function detailText(item: BillItem): string {
  if (item.kind === "card") {
    const free = item.card?.limitFree;
    return `Fecha dia ${item.card?.closingDay}${free !== null && free !== undefined ? ` · limite livre ${formatCurrency(free)}` : ""}`;
  }
  if (item.kind === "debt" && item.debt) {
    const { installmentNumber, installmentsCount, remainingAmount } = item.debt;
    return `Parcela ${installmentNumber} de ${installmentsCount}${remainingAmount > 0 ? ` · faltam ${formatCurrency(remainingAmount)}` : ""}`;
  }
  return item.isPaid ? "Lançada sozinha no dia" : "Lança sozinha no dia";
}

// Contas: tudo que tem que pagar numa lista só, pelo que vence primeiro --
// faturas, parcelas e contas fixas juntas, com o pagar a um toque. As telas
// de cada tipo continuam (tocar num item abre os detalhes).
export function BillsPage() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const cacheKey = `bills:${user?.id}`;
  const [data, setData] = useState<BillsOverview | null>(() => readCache<BillsOverview>(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const fresh = await apiRequest<BillsOverview>("/bills", { token });
      setData(fresh);
      writeCache(cacheKey, fresh);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não deu pra carregar as contas.");
    }
  }, [token, cacheKey]);

  useEffect(() => {
    void load();
  }, [load]);

  async function togglePaid(item: BillItem) {
    if (!item.pay) return;
    const isPaid = !item.isPaid;
    setBusyId(item.id);
    // Otimista: a linha muda na hora, o servidor confirma por trás.
    setData((current) =>
      current ? { ...current, items: current.items.map((i) => (i.id === item.id ? { ...i, isPaid } : i)) } : current
    );
    try {
      if (item.pay.type === "card") {
        await apiRequest(`/cards/${item.pay.cardId}/statements/${item.pay.month}`, { method: "PATCH", token, body: { isPaid } });
      } else {
        await apiRequest(`/debts/${item.pay.debtId}/installments/${item.pay.installmentId}`, { method: "PATCH", token, body: { isPaid } });
      }
      showToast(isPaid ? `${item.title}: paga` : `${item.title}: voltou pra em aberto`, { variant: "success" });
    } catch (err) {
      showToast("Não deu pra marcar", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusyId(null);
      void load();
    }
  }

  const view = useMemo(() => {
    if (!data) return null;
    const pick = (item: BillItem) => filter === "all" || filter === item.kind;
    const open = data.items.filter((item) => pick(item) && !item.isPaid);
    return {
      late: open.filter((item) => item.daysUntil !== null && item.daysUntil < 0),
      week: open.filter((item) => item.daysUntil !== null && item.daysUntil >= 0 && item.daysUntil <= 7),
      later: open.filter((item) => item.daysUntil === null || item.daysUntil > 7),
      paid: data.items.filter((item) => pick(item) && item.isPaid),
    };
  }, [data, filter]);

  function row(item: BillItem) {
    const due = dueText(item);
    const isOpen = openId === item.id;
    return (
      <li key={item.id} className={`bill-row${item.isPaid ? " is-paid" : ""}`}>
        <button
          type="button"
          className="bill-row-main"
          aria-expanded={isOpen}
          onClick={() => setOpenId(isOpen ? null : item.id)}
        >
          <span className="bill-row-icon" aria-hidden="true">
            <Icon name={KIND[item.kind].icon} />
          </span>
          <span className="bill-row-text">
            <span className="bill-row-title">{item.title}</span>
            <span className="bill-row-meta">
              {filter === "all" && <span className="bill-tag">{KIND[item.kind].label}</span>}
              {detailText(item)}
            </span>
            {!item.isPaid && <span className={`bill-row-due ${due.tone}`}>{due.text}</span>}
          </span>
        </button>
        <span className="bill-row-side">
        <span className="bill-row-amount">{formatCurrency(item.amount)}</span>
        {item.pay ? (
          <button
            type="button"
            className={`bill-pay${item.isPaid ? " done" : ""}`}
            onClick={() => void togglePaid(item)}
            disabled={busyId === item.id}
            aria-label={item.isPaid ? `Desmarcar ${item.title} como paga` : `Marcar ${item.title} como paga`}
          >
            {item.isPaid ? (
              <>
                <Icon name="check" /> Pago
              </>
            ) : (
              "Pagar"
            )}
          </button>
        ) : (
          item.isPaid && <span className="bill-pay done static"><Icon name="check" /> Lançada</span>
        )}
        </span>
        {isOpen && (
          <div className="bill-row-more">
            {item.kind === "debt" && item.debt && (
              <div className="bill-progress" role="img" aria-label={`${item.debt.paidCount} de ${item.debt.installmentsCount} parcelas pagas`}>
                <i style={{ width: `${(item.debt.paidCount / item.debt.installmentsCount) * 100}%` }} />
              </div>
            )}
            <Link to={item.link} className="link">
              {item.kind === "card" ? "Abrir o cartão (limite e compras)" : item.kind === "debt" ? "Ver todas as parcelas" : "Editar conta fixa"} →
            </Link>
          </div>
        )}
      </li>
    );
  }

  function section(title: string, items: BillItem[], tone = "") {
    if (items.length === 0) return null;
    return (
      <section className="bills-section">
        <h2 className={`bills-section-title ${tone}`}>
          <span>{title}</span>
          <span>{formatCurrency(items.reduce((sum, item) => sum + item.amount, 0))}</span>
        </h2>
        <ul className="bills-list">{items.map(row)}</ul>
      </section>
    );
  }

  const summary = data?.summary;
  const soonText = summary
    ? [
        summary.overdueCount > 0 ? `${summary.overdueCount} ${summary.overdueCount === 1 ? "vencida" : "vencidas"}` : null,
        summary.dueSoonCount > 0 ? `${summary.dueSoonCount} ${summary.dueSoonCount === 1 ? "vence" : "vencem"} em até 7 dias` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "Nada vencendo essa semana"
    : "";
  const loans = data?.loans ?? [];
  const nothing = !!data && data.items.length === 0 && loans.length === 0;

  return (
    <AppLayout>
      <div className="page-stack bills-page">
        <BillsTabs />
        {error && <p className="alert">{error}</p>}
        {!data ? (
          !error && <PageSkeleton cards={3} />
        ) : (
          <>
            <div className="bills-summary">
              <span>Falta pagar nos próximos 30 dias</span>
              <strong>{formatCurrency(summary!.toPay)}</strong>
              <span>{soonText}</span>
            </div>

            <div className="bills-filters" role="group" aria-label="Filtrar">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  className={`bills-filter${filter === value ? " active" : ""}`}
                  onClick={() => {
                    setFilter(value);
                    setOpenId(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {nothing && (
              <div className="card bills-empty">
                <p>Nenhuma conta por aqui ainda.</p>
                <p className="field-hint">Cadastre um cartão, uma conta fixa (aluguel, internet) ou uma compra parcelada e ela aparece aqui na data certa.</p>
              </div>
            )}

            {filter !== "loans" && view && (
              <>
                {section("Vencidas", view.late, "late")}
                {section("Próximos 7 dias", view.week)}
                {section("Mais pra frente", view.later)}
                {!nothing && view.late.length + view.week.length + view.later.length === 0 && (
                  <p className="bills-none">Nada em aberto aqui nos próximos 30 dias.</p>
                )}
                {view.paid.length > 0 && (
                  <section className="bills-section">
                    <button type="button" className="bills-paid-toggle" aria-expanded={showPaid} onClick={() => setShowPaid((v) => !v)}>
                      {showPaid ? "Esconder" : "Ver"} pagas este mês ({view.paid.length})
                    </button>
                    {showPaid && <ul className="bills-list">{view.paid.map(row)}</ul>}
                  </section>
                )}
              </>
            )}

            {(filter === "all" || filter === "loans") && (loans.length > 0 || filter === "loans") && (
              <section className="bills-section">
                <h2 className="bills-section-title">
                  <span>Empréstimos</span>
                </h2>
                {loans.length === 0 ? (
                  <p className="bills-none">Ninguém te deve e você não deve pra ninguém.</p>
                ) : (
                  <ul className="bills-list">
                    {loans.map((loan) => (
                      <li key={loan.id} className="bill-row">
                        <Link to={loan.direction === "borrowed" ? "/loans?lado=devo" : "/loans"} className="bill-row-main">
                          <span className="bill-row-icon" aria-hidden="true">
                            <Icon name="coin" />
                          </span>
                          <span className="bill-row-text">
                            <span className="bill-row-title">
                              {loan.direction === "borrowed" ? `Você deve pra ${loan.personName}` : `${loan.personName} te deve`}
                            </span>
                            <span className={`bill-row-due ${loan.isOverdue ? "late" : ""}`}>
                              {loan.isOverdue ? "Prazo passou" : loan.dueDate ? `Prazo ${shortDate(loan.dueDate)}` : "Sem prazo"}
                            </span>
                          </span>
                        </Link>
                        <span className="bill-row-side">
                          <span className={`bill-row-amount ${loan.direction === "borrowed" ? "owe" : "gain"}`}>
                            {loan.direction === "borrowed" ? "− " : "+ "}
                            {formatCurrency(loan.remaining)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <div className="bills-add">
              <span>Adicionar:</span>
              <Link to="/cards" className="bills-add-link">Cartão</Link>
              <Link to="/a-pagar?aba=fixas" className="bills-add-link">Conta fixa</Link>
              <Link to="/a-pagar?aba=dividas" className="bills-add-link">Parcelada</Link>
              <Link to="/loans" className="bills-add-link">Empréstimo</Link>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
