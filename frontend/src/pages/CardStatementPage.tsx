// FATURA DO CARTÃO -- tela própria, no estilo da fatura do banco.
// Endereço: /cards/:id/fatura (opcional ?mes=AAAA-MM). Abre pelo nome do
// cartão no Painel ou pelo "Ver fatura" em Cartões.
// Dados (rotas que já existiam, nada novo no backend):
//   - GET /api/cards                       -> nome, limite, limite usado, dia que fecha
//   - GET /api/cards/:id/statement?month=  -> total, vencimento, paga, compras
//   - PATCH /api/cards/:id/statements/:mes -> marcar como paga / reabrir
//   - GET /api/cards/:id/statements        -> todas as faturas, mês a mês (faixa de meses)
//   - POST/PATCH/DELETE /api/cards/:id/purchases -> lançar / editar / remover compra
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { categoriesFor, type CategoryType } from "../utils/categories";
import {
  formatCurrency,
  monthLongName,
  monthYearLabel,
  nextMonthParam,
  parseLocalDate,
  previousMonthParam,
  todayISO,
} from "../utils/format";
import { initialOf } from "../utils/initial";

interface CardRow {
  id: string;
  name: string;
  closingDay: number;
  limit: string | null;
  limitUsed: string | null;
  currentStatement: { month: string };
}

interface PurchaseRow {
  id: string;
  description: string;
  amount: string;
  categoryId: string | null;
  buyerId: string;
  purchaseDate: string;
  installmentNumber: number;
  installmentsCount: number;
}

interface StatementDetail {
  month: string;
  dueDate: string;
  total: string;
  isPaid: boolean;
  purchases: PurchaseRow[];
}

interface StatementMonthRow {
  month: string;
  dueDate: string;
  total: string;
  isPaid: boolean;
}

interface CategoryRow {
  id: string;
  name: string;
  type?: CategoryType;
}

interface MemberRow {
  id: string;
  displayName: string;
}

// As mesmas opções de Cartões e da Nova despesa (o backend só aceita estas).
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 12];

// "3 de novembro" -- sem o "Hoje"/"Ontem" do dayLabel de utils/format: numa
// fatura conta a data da compra.
function purchaseDayLabel(iso: string): string {
  return parseLocalDate(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

export function CardStatementPage() {
  const { id: cardId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [card, setCard] = useState<CardRow | null>(null);
  const [statement, setStatement] = useState<StatementDetail | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editing, setEditing] = useState<PurchaseRow | null>(null);
  const [statementMonths, setStatementMonths] = useState<StatementMonthRow[]>([]);

  // Mês da fatura: o da URL (?mes=) ou, sem ele, a fatura atual do cartão.
  const month = searchParams.get("mes") ?? card?.currentStatement.month ?? null;

  const loadCard = useCallback(async () => {
    const cards = await apiRequest<CardRow[]>("/cards", { token });
    const found = cards.find((c) => c.id === cardId) ?? null;
    setCard(found);
    if (!found) setError("Cartão não encontrado.");
    return found;
  }, [cardId, token]);

  const loadStatement = useCallback(
    async (target: string) => {
      setIsLoading(true);
      try {
        setStatement(await apiRequest<StatementDetail>(`/cards/${encodeURIComponent(cardId)}/statement?month=${encodeURIComponent(target)}`, { token }));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Não foi possível carregar a fatura");
      } finally {
        setIsLoading(false);
      }
    },
    [cardId, token]
  );

  // Todas as faturas do cartão, uma por mês, pra faixa de meses no topo.
  const loadStatementMonths = useCallback(async () => {
    try {
      setStatementMonths(await apiRequest<StatementMonthRow[]>(`/cards/${encodeURIComponent(cardId)}/statements`, { token }));
    } catch {
      setStatementMonths([]);
    }
  }, [cardId, token]);

  useEffect(() => {
    void loadStatementMonths();
  }, [loadStatementMonths]);

  useEffect(() => {
    loadCard().catch((err) => setError(err instanceof ApiError ? err.message : "Não foi possível carregar o cartão"));
    apiRequest<CategoryRow[]>("/categories", { token })
      .then(setCategories)
      .catch(() => setCategories([]));
    apiRequest<{ members: MemberRow[] }>("/groups/me", { token })
      .then((group) => setMembers(group.members))
      .catch(() => setMembers([]));
  }, [loadCard, token]);

  useEffect(() => {
    if (month) void loadStatement(month);
  }, [month, loadStatement]);

  function goTo(direction: -1 | 1) {
    if (!month) return;
    setSearchParams({ mes: direction < 0 ? previousMonthParam(month) : nextMonthParam(month) }, { replace: true });
  }

  const memberName = (userId: string) =>
    userId === user?.id ? "Você" : (members.find((member) => member.id === userId)?.displayName ?? "Alguém do grupo");
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Sem categoria";

  // Compras agrupadas por dia da compra, da mais recente pra mais antiga.
  const days = useMemo(() => {
    const groups = new Map<string, PurchaseRow[]>();
    for (const purchase of [...(statement?.purchases ?? [])].sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))) {
      const list = groups.get(purchase.purchaseDate) ?? [];
      list.push(purchase);
      groups.set(purchase.purchaseDate, list);
    }
    return [...groups.entries()].map(([date, purchases]) => ({
      date,
      purchases,
      total: purchases.reduce((sum, p) => sum + Number(p.amount), 0),
    }));
  }, [statement]);

  // A faixa mostra as faturas com compra + o mês aberto agora (mesmo vazio,
  // quando a pessoa navega pelas setas pra um mês sem nada).
  const monthChips = useMemo(() => {
    const list = [...statementMonths];
    if (month && !list.some((s) => s.month === month)) {
      list.push({ month, dueDate: "", total: "0", isPaid: false });
    }
    return list.sort((a, b) => b.month.localeCompare(a.month));
  }, [statementMonths, month]);

  async function refresh() {
    await Promise.all([loadCard(), loadStatementMonths(), month ? loadStatement(month) : Promise.resolve()]);
  }

  async function togglePaid() {
    if (!statement || !month) return;
    if (!statement.isPaid) {
      const confirmed = await confirm({
        title: `Marcar a fatura de ${monthYearLabel(month)} como paga?`,
        body: `Isso lança uma despesa de ${formatCurrency(Number(statement.total))} dividida entre quem comprou o quê.`,
        confirmLabel: "Marcar como paga",
        tone: "primary",
      });
      if (!confirmed) return;
    }
    try {
      await apiRequest(`/cards/${encodeURIComponent(cardId)}/statements/${encodeURIComponent(month)}`, { method: "PATCH", token, body: { isPaid: !statement.isPaid } });
      showToast(statement.isPaid ? "Fatura reaberta" : "Fatura paga", statement.isPaid ? { variant: "info" } : undefined);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a fatura");
    }
  }

  async function removePurchase(purchase: PurchaseRow) {
    const confirmed = await confirm({
      title: "Remover essa compra?",
      body: purchase.installmentsCount > 1 ? "Sai só esta parcela; as outras continuam nas próximas faturas." : "Ela sai da fatura.",
      confirmLabel: "Remover compra",
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cards/${encodeURIComponent(cardId)}/purchases/${purchase.id}`, { method: "DELETE", token });
      showToast("Compra excluída");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a compra");
    }
  }

  const limit = card?.limit !== null && card?.limit !== undefined ? Number(card.limit) : null;
  const used = card?.limitUsed !== null && card?.limitUsed !== undefined ? Number(card.limitUsed) : null;
  const usedPercent = limit && used !== null ? Math.min(100, (used / limit) * 100) : 0;

  return (
    <AppLayout>
      <div className="page-stack fatura-page">
        <Link to="/cards" className="link">
          ← Cartões
        </Link>
        <div className="fatura-head">
          <h1>{card?.name ?? "Fatura"}</h1>
          {month && (
            <div className="fatura-months">
              <button type="button" onClick={() => goTo(-1)} aria-label="Fatura anterior">
                ‹
              </button>
              <span className="fatura-month-label">{monthYearLabel(month)}</span>
              <button type="button" onClick={() => goTo(1)} aria-label="Próxima fatura">
                ›
              </button>
            </div>
          )}
        </div>

        {/* Uma fatura por mês: toca no mês pra ver só as compras dela. */}
        {statementMonths.length > 0 && month && (
          <nav className="fatura-month-strip" aria-label="Faturas por mês">
            {monthChips.map((s) => (
                <button
                  key={s.month}
                  type="button"
                  className={`fatura-month-chip${s.month === month ? " active" : ""}`}
                  aria-current={s.month === month ? "true" : undefined}
                  onClick={() => setSearchParams({ mes: s.month }, { replace: true })}
                >
                  <span className="fatura-month-chip-name">
                    {monthLongName(s.month).slice(0, 3)}/{s.month.slice(2, 4)}
                  </span>
                  <span className="fatura-month-chip-total">{formatCurrency(Number(s.total))}</span>
                  <span className={`fatura-month-chip-status${s.isPaid ? " paid" : ""}`}>
                    {s.isPaid ? "Paga" : s.month === card?.currentStatement.month ? "Atual" : s.month > (card?.currentStatement.month ?? "") ? "Futura" : "Aberta"}
                  </span>
                </button>
              ))}
          </nav>
        )}

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {statement && month && (
          <section className="fatura-summary" aria-label="Resumo da fatura">
            <div className="fatura-summary-top">
              <div>
                <p className="fatura-kicker">Fatura de {monthLongName(month)}</p>
                <p className="fatura-total">{formatCurrency(Number(statement.total))}</p>
                <p className="fatura-due">
                  Vence <strong>{parseLocalDate(statement.dueDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</strong>
                  {card ? ` · fecha dia ${card.closingDay}` : ""}
                </p>
              </div>
              <span className={`fatura-status${statement.isPaid ? " paid" : ""}`}>{statement.isPaid ? "Paga" : "Aberta"}</span>
            </div>
            {limit !== null && used !== null && (
              <div className="fatura-limit">
                <div className="fatura-limit-track" role="img" aria-label={`${Math.round(usedPercent)}% do limite usado`}>
                  <div className="fatura-limit-fill" style={{ width: `${usedPercent}%` }} />
                </div>
                <div className="fatura-limit-text">
                  <span>
                    Limite usado: {formatCurrency(used)} de {formatCurrency(limit)}
                  </span>
                  <span>{used >= limit ? `Passou ${formatCurrency(used - limit)}` : `Sobram ${formatCurrency(limit - used)}`}</span>
                </div>
              </div>
            )}
            <div className="fatura-actions">
              {statement.purchases.length > 0 && (
                <button type="button" className="btn btn-pay" onClick={() => void togglePaid()}>
                  {statement.isPaid ? "Reabrir fatura" : "Marcar como paga"}
                </button>
              )}
              {!statement.isPaid && (
                <button type="button" className="btn btn-ghost-band" onClick={() => setIsAdding(true)}>
                  + Lançar compra
                </button>
              )}
            </div>
          </section>
        )}

        <section className="fatura-list" aria-label="Compras da fatura" aria-busy={isLoading}>
          {statement && days.length === 0 && <p className="fatura-empty">Nenhuma compra nessa fatura.</p>}
          {days.map((day) => (
            <div key={day.date}>
              <div className="fatura-day">
                <span>{purchaseDayLabel(day.date)}</span>
                <span>{formatCurrency(day.total)}</span>
              </div>
              {day.purchases.map((purchase) => (
                <div key={purchase.id} className="fatura-row">
                  <span className="fatura-row-icon" aria-hidden="true">
                    {initialOf(purchase.description)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="fatura-row-desc">
                      <span className="text-truncate">{purchase.description}</span>
                      {purchase.installmentsCount > 1 && (
                        <span className="fatura-parcela">
                          {purchase.installmentNumber}/{purchase.installmentsCount}
                        </span>
                      )}
                    </div>
                    <div className="fatura-row-meta">
                      {memberName(purchase.buyerId)} · {categoryName(purchase.categoryId)}
                    </div>
                  </div>
                  <span className="fatura-row-amount">
                    {formatCurrency(Number(purchase.amount))}
                    {!statement?.isPaid && (
                      <button
                        type="button"
                        className="btn-icon"
                        title="Editar compra"
                        aria-label={`Editar ${purchase.description}`}
                        onClick={() => setEditing(purchase)}
                      >
                        <Icon name="pencil" />
                      </button>
                    )}
                    {!statement?.isPaid && (
                      <button
                        type="button"
                        className="btn-icon"
                        title="Remover compra"
                        aria-label={`Remover ${purchase.description}`}
                        onClick={() => void removePurchase(purchase)}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </section>
      </div>

      {(isAdding || editing) && (
        <PurchaseSheet
          cardId={cardId}
          purchase={editing}
          categories={categoriesFor(categories, "expense")}
          members={members}
          onClose={() => {
            setIsAdding(false);
            setEditing(null);
          }}
          onSaved={async () => {
            showToast(editing ? "Compra atualizada" : "Compra lançada no cartão");
            setIsAdding(false);
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </AppLayout>
  );
}

// Mesma compra que dá pra lançar em Cartões: o que foi, valor, data,
// parcelas, categoria e quem comprou. Com `purchase`, edita essa compra:
// nome, categoria e quem comprou valem pra todas as parcelas em aberto; o
// valor é só o desta parcela; a data só muda na compra à vista (e pode
// levar a compra pra outra fatura).
function PurchaseSheet({
  cardId,
  purchase,
  categories,
  members,
  onClose,
  onSaved,
}: {
  cardId: string;
  purchase: PurchaseRow | null;
  categories: CategoryRow[];
  members: MemberRow[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { user, token } = useAuth();
  const isEdit = purchase !== null;
  const isInstallment = (purchase?.installmentsCount ?? 1) > 1;
  const [description, setDescription] = useState(purchase?.description ?? "");
  const [amount, setAmount] = useState(purchase ? Number(purchase.amount).toFixed(2).replace(".", ",") : "");
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchaseDate ?? todayISO());
  const [installments, setInstallments] = useState("1");
  const [categoryId, setCategoryId] = useState(purchase?.categoryId ?? "");
  const [buyerId, setBuyerId] = useState(purchase?.buyerId ?? user?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(amount.includes(",") ? amount.replace(/\./g, "").replace(",", ".") : amount);
    if (!description.trim() || !(parsedAmount > 0) || !buyerId || !purchaseDate) {
      setError("Informe descrição, valor, quem comprou e a data.");
      return;
    }
    setIsSaving(true);
    try {
      const base = {
        description: description.trim(),
        amount: parsedAmount,
        categoryId: categoryId || null,
        buyerId,
        purchaseDate,
      };
      if (purchase) {
        await apiRequest(`/cards/${encodeURIComponent(cardId)}/purchases/${encodeURIComponent(purchase.id)}`, {
          method: "PATCH",
          token,
          body: base,
        });
      } else {
        await apiRequest(`/cards/${encodeURIComponent(cardId)}/purchases`, {
          method: "POST",
          token,
          body: { ...base, installments: Number(installments) },
        });
      }
      await onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "A fatura desse mês já foi paga. Mude a data ou reabra a fatura."
          : err instanceof ApiError
            ? err.message
            : isEdit
              ? "Não foi possível salvar a compra"
              : "Não foi possível lançar a compra"
      );
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="purchase-sheet-title">
      <h1 id="purchase-sheet-title">{isEdit ? "Editar compra" : "Lançar compra"}</h1>
      {isInstallment && purchase && (
        <p className="refresh-note">
          Parcela {purchase.installmentNumber}/{purchase.installmentsCount}. Nome, categoria e quem comprou mudam em todas as parcelas
          em aberto; o valor muda só nesta.
        </p>
      )}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="purchase-description">O que foi</label>
          <input id="purchase-description" value={description} onChange={(e) => setDescription(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="purchase-amount">{isInstallment ? "Valor desta parcela (R$)" : "Valor (R$)"}</label>
          <input id="purchase-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="purchase-date">Data da compra</label>
          <input
            id="purchase-date"
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
            disabled={isInstallment}
            required
          />
          {isEdit && !isInstallment && <p className="field-hint">Mudar a data pode passar a compra pra outra fatura.</p>}
        </div>
        {!isEdit && (
          <div className="field">
            <label htmlFor="purchase-installments">Parcelas</label>
            <select id="purchase-installments" value={installments} onChange={(e) => setInstallments(e.target.value)}>
              {INSTALLMENT_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count === 1 ? "À vista" : `${count}x`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="purchase-category">Categoria (opcional)</label>
          <select id="purchase-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        {members.length > 1 && (
          <div className="field">
            <label htmlFor="purchase-buyer">Quem comprou</label>
            <select id="purchase-buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id === user?.id ? "Você" : member.displayName}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={isSaving}>
          {isSaving ? "Salvando..." : isEdit ? "Salvar alterações" : "Lançar no cartão"}
        </button>
      </form>
    </Sheet>
  );
}
