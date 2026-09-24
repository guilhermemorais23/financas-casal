import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { AppLayout } from "../layouts/AppLayout";
import { currentMonthParam, formatCurrency, monthYearLabel, parseLocalDate } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";
import { Icon } from "../components/Icon";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { BillsTabs } from "../components/BillsTabs";

interface MemberRow {
  id: string;
  displayName: string;
}

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

interface PersonTotal {
  userId: string;
  total: string;
}

interface StatementSummary {
  month: string;
  dueDate: string;
  total: string;
  isPaid: boolean;
  byPerson: PersonTotal[];
}

interface CardRow {
  id: string;
  scope: "personal" | "joint";
  name: string;
  closingDay: number;
  dueDay: number;
  currentStatement: StatementSummary;
  limit: string | null;
  limitUsed: string | null;
  limitType: "normal" | "secured";
  limitReleases: LimitRelease[];
}

interface LimitRelease {
  month: string;
  dueDate: string;
  amount: string;
  availableAfter: string;
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

const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 12];

interface StatementDetail extends StatementSummary {
  purchases: PurchaseRow[];
}

export function CardsPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const cacheKey = `cards:${user?.id ?? "anon"}`;

  const [cards, setCards] = useState<CardRow[] | null>(() => readCache(cacheKey));
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [closingDay, setClosingDay] = useState("28");
  const [dueDay, setDueDay] = useState("5");
  const [limit, setLimit] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [limitType, setLimitType] = useState<"normal" | "secured">("normal");
  const [scope, setScope] = useState<"personal" | "joint">("joint");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [statementMonth, setStatementMonth] = useState(currentMonthParam());
  const [statement, setStatement] = useState<StatementDetail | null>(null);
  const [isLoadingStatement, setIsLoadingStatement] = useState(false);

  const [purchaseDescription, setPurchaseDescription] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [purchaseCategoryId, setPurchaseCategoryId] = useState("");
  const [purchaseBuyerId, setPurchaseBuyerId] = useState(user?.id ?? "");
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [purchaseInstallments, setPurchaseInstallments] = useState("1");
  const [isAddingPurchase, setIsAddingPurchase] = useState(false);

  // "Guardar mais" / "Resgatar" on a cartão com limite garantido -- one
  // inline form at a time, tied to whichever card opened it.
  const [limitAdjust, setLimitAdjust] = useState<{ cardId: string; direction: "deposit" | "withdraw" } | null>(null);
  const [limitAdjustAmount, setLimitAdjustAmount] = useState("");
  const [limitAdjustError, setLimitAdjustError] = useState<string | null>(null);

  async function loadCards() {
    try {
      const result = await apiRequest<CardRow[]>("/cards", { token });
      setCards(result);
      writeCache(cacheKey, result);
    } catch (err) {
      // Leaves `cards` as whatever it was (cached or null) -- the empty-
      // state sections below only render once `cards` is non-null, so a
      // failed load never gets mistaken for "confirmed no cards".
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os cartões");
    }
  }

  useEffect(() => {
    loadCards();
    apiRequest<{ members: MemberRow[] }>("/groups/me", { token }).then((res) => setMembers(res.members));
    apiRequest<CategoryRow[]>("/categories", { token }).then(setCategories);
  }, [token]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedClosing = Number(closingDay);
    const parsedDue = Number(dueDay);
    const parsedLimit = limit.trim() ? Number(limit.replace(",", ".")) : null;
    if (!name.trim() || !(parsedClosing >= 1 && parsedClosing <= 31) || !(parsedDue >= 1 && parsedDue <= 31)) {
      setError("Informe nome, dia de fechamento e dia de vencimento (1 a 31).");
      return;
    }
    if (parsedLimit !== null && !(parsedLimit > 0)) {
      setError("O limite, se preenchido, precisa ser maior que zero.");
      return;
    }
    if (limitType === "secured" && parsedLimit === null) {
      setError("Informe quanto você guardou no cartão -- é esse valor que vira o limite.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/cards", {
        method: "POST",
        token,
        body: { name: name.trim(), closingDay: parsedClosing, dueDay: parsedDue, scope, limit: parsedLimit, limitType },
      });
      setName("");
      setClosingDay("28");
      setDueDay("5");
      setLimit("");
      setLimitType("normal");
      setIsCreateOpen(false);
      showToast("Cartão criado");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o cartão");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCard(cardId: string) {
    const confirmed = await confirm({
      title: "Excluir esse cartão?",
      body: "Isso também remove as compras e as faturas pagas geradas por ele.",
      confirmLabel: "Excluir cartão",
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cards/${cardId}`, { method: "DELETE", token });
      if (expandedCardId === cardId) setExpandedCardId(null);
      showToast("Cartão excluído");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover o cartão");
    }
  }

  async function loadStatement(cardId: string, month: string) {
    setIsLoadingStatement(true);
    try {
      const result = await apiRequest<StatementDetail>(`/cards/${cardId}/statement?month=${month}`, { token });
      setStatement(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar a fatura");
    } finally {
      setIsLoadingStatement(false);
    }
  }

  function toggleExpand(card: CardRow) {
    if (expandedCardId === card.id) {
      setExpandedCardId(null);
      setStatement(null);
      return;
    }
    setExpandedCardId(card.id);
    setIsAddingPurchase(false);
    const month = card.currentStatement.month;
    setStatementMonth(month);
    loadStatement(card.id, month);
  }

  function handleMonthChange(cardId: string, month: string) {
    setStatementMonth(month);
    loadStatement(cardId, month);
  }

  async function handleAddPurchase(event: FormEvent, cardId: string) {
    event.preventDefault();
    setError(null);
    const parsedAmount = Number(purchaseAmount.replace(",", "."));
    if (!purchaseDescription.trim() || !(parsedAmount > 0) || !purchaseBuyerId || !purchaseDate) {
      setError("Informe descrição, valor, quem comprou e a data.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/cards/${cardId}/purchases`, {
        method: "POST",
        token,
        body: {
          description: purchaseDescription.trim(),
          amount: parsedAmount,
          categoryId: purchaseCategoryId || null,
          buyerId: purchaseBuyerId,
          purchaseDate,
          installments: Number(purchaseInstallments),
        },
      });
      setPurchaseDescription("");
      setPurchaseAmount("");
      setPurchaseCategoryId("");
      setPurchaseInstallments("1");
      setIsAddingPurchase(false);
      showToast("Compra lançada no cartão");
      await loadStatement(cardId, statementMonth);
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível lançar a compra");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeletePurchase(cardId: string, purchaseId: string) {
    try {
      await apiRequest(`/cards/${cardId}/purchases/${purchaseId}`, { method: "DELETE", token });
      showToast("Compra excluída");
      await loadStatement(cardId, statementMonth);
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a compra");
    }
  }

  async function handleToggleStatementPaid(card: CardRow) {
    const isPaid = statement?.isPaid ?? card.currentStatement.isPaid;
    if (!isPaid) {
      const confirmed = await confirm({
        title: `Marcar a fatura de ${monthYearLabel(statementMonth)} como paga?`,
        body: `Isso lança uma despesa de ${formatCurrency(
          Number(statement?.total ?? card.currentStatement.total)
        )} dividida entre quem comprou o quê.`,
        confirmLabel: "Marcar como paga",
        tone: "primary",
      });
      if (!confirmed) return;
    }
    try {
      await apiRequest(`/cards/${card.id}/statements/${statementMonth}`, {
        method: "PATCH",
        token,
        body: { isPaid: !isPaid },
      });
      showToast(isPaid ? "Fatura reaberta" : "Fatura paga", isPaid ? { variant: "info" } : undefined);
      await loadStatement(card.id, statementMonth);
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a fatura");
    }
  }

  function openLimitAdjust(cardId: string, direction: "deposit" | "withdraw") {
    const isSameForm = limitAdjust?.cardId === cardId && limitAdjust.direction === direction;
    setLimitAdjust(isSameForm ? null : { cardId, direction });
    setLimitAdjustAmount("");
    setLimitAdjustError(null);
  }

  async function handleLimitAdjust(event: FormEvent, card: CardRow, available: number) {
    event.preventDefault();
    if (!limitAdjust) return;
    setLimitAdjustError(null);
    const parsedAmount = Number(limitAdjustAmount.replace(",", "."));
    if (!(parsedAmount > 0)) {
      setLimitAdjustError("Informe um valor maior que zero.");
      return;
    }
    if (limitAdjust.direction === "withdraw" && parsedAmount > available) {
      setLimitAdjustError(`Dá pra resgatar até ${formatCurrency(available)} agora -- o resto está preso em faturas não pagas.`);
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/cards/${card.id}/secured-limit`, {
        method: "POST",
        token,
        body: { direction: limitAdjust.direction, amount: parsedAmount },
      });
      showToast(limitAdjust.direction === "deposit" ? "Guardado no limite" : "Resgatado do limite");
      setLimitAdjust(null);
      setLimitAdjustAmount("");
      await loadCards();
    } catch (err) {
      setLimitAdjustError(err instanceof ApiError ? err.message : "Não foi possível atualizar o limite");
    } finally {
      setIsSubmitting(false);
    }
  }

  function memberName(userId: string) {
    if (userId === user?.id) return "Você";
    return members.find((m) => m.id === userId)?.displayName ?? "Alguém do grupo";
  }

  function renderCard(card: CardRow) {
    const isExpanded = expandedCardId === card.id;
    const s = card.currentStatement;
    const limitCents = card.limit !== null ? Number(card.limit) : null;
    const limitUsedCents = card.limitUsed !== null ? Number(card.limitUsed) : null;
    const limitRawPercent = limitCents && limitUsedCents !== null ? (limitUsedCents / limitCents) * 100 : 0;
    const limitPercent = Math.min(100, limitRawPercent);
    const limitTone = limitRawPercent >= 100 ? "over" : limitRawPercent >= 80 ? "warning" : "";
    const isSecured = card.limitType === "secured";
    const available = limitCents !== null && limitUsedCents !== null ? Math.max(0, limitCents - limitUsedCents) : 0;
    return (
      <div key={card.id} className="card debt-card">
        <div className="section-header">
          <p className="card-title">
            {card.scope === "joint" ? "💞" : "👤"} 🧾 {card.name}
          </p>
          <div className="transaction-row-actions">
            <button type="button" className="btn-icon" title="Remover cartão" onClick={() => handleDeleteCard(card.id)}>
              ✕
            </button>
          </div>
        </div>
        <p className="card-subtitle" style={{ marginBottom: "0.75rem" }}>
          Fecha dia {card.closingDay} · vence dia {card.dueDay}
        </p>

        <div className="goal-amounts">
          <span className="debt-mini-value">{formatCurrency(Number(s.total))} nesta fatura</span>
          <span className="debt-mini-remaining">
            {s.isPaid ? "✓ paga" : `vence ${monthYearLabel(s.month)}`}
          </span>
        </div>

        {limitCents !== null && limitUsedCents !== null && (
          <>
            <div className="goal-amounts" style={{ marginTop: "0.6rem" }}>
              <span className="debt-mini-value">
                {isSecured ? "Guardado" : "Limite"} {formatCurrency(limitCents)}
              </span>
              <span className="debt-mini-remaining">disponível agora {formatCurrency(available)}</span>
            </div>
            <div className="progress-track thin">
              <div className={`progress-fill ${limitTone}`} style={{ width: `${limitPercent}%` }} />
            </div>

            {isSecured && (
              <p className="field-hint">
                Esse dinheiro continua seu, só fica parado como garantia. A fatura você paga com o dinheiro da conta, e
                pagar devolve o limite.
              </p>
            )}

            {isSecured && (
              <div className="limit-adjust-actions">
                <button type="button" className="btn btn-outline" onClick={() => openLimitAdjust(card.id, "deposit")}>
                  Guardar mais
                </button>
                <button type="button" className="btn btn-outline" onClick={() => openLimitAdjust(card.id, "withdraw")}>
                  Resgatar
                </button>
              </div>
            )}

            {limitAdjust?.cardId === card.id && (
              <form className="limit-adjust-form" onSubmit={(e) => handleLimitAdjust(e, card, available)}>
                <div className="field">
                  <label htmlFor={`limit-adjust-${card.id}`}>
                    {limitAdjust.direction === "deposit" ? "Quanto vai guardar (R$)" : "Quanto vai resgatar (R$)"}
                  </label>
                  <input
                    id={`limit-adjust-${card.id}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={limitAdjustAmount}
                    onChange={(e) => setLimitAdjustAmount(e.target.value)}
                    autoFocus
                    required
                  />
                  <p className="field-hint">
                    {limitAdjust.direction === "deposit"
                      ? "Sai da sua conta hoje e vira limite na hora."
                      : `Volta pra sua conta. Você pode resgatar até ${formatCurrency(available)}: o que está em compras fica preso até a fatura ser paga.`}
                  </p>
                </div>
                {limitAdjustError && (
                  <p className="alert" role="alert">
                    {limitAdjustError}
                  </p>
                )}
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? "Salvando..." : limitAdjust.direction === "deposit" ? "Guardar" : "Resgatar"}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setLimitAdjust(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            )}

            {card.limitReleases?.length > 0 && (
              <div className="limit-releases">
                <p className="limit-releases-title">Quando o limite volta</p>
                <ul>
                  {card.limitReleases.map((release) => (
                    <li key={release.month}>
                      <span>
                        Pagando a fatura de {monthYearLabel(release.month)}
                        <span className="limit-releases-meta">
                          vence{" "}
                          {parseLocalDate(release.dueDate).toLocaleDateString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                          })}{" "}
                          · volta {formatCurrency(Number(release.amount))}
                        </span>
                      </span>
                      <strong>{formatCurrency(Math.max(0, Number(release.availableAfter)))}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {s.byPerson.length > 0 && (
          <div className="stat-row wrap" style={{ marginTop: "0.75rem" }}>
            {s.byPerson.map((person) => (
              <div className="stat" key={person.userId} style={{ flex: "1 1 100px" }}>
                <p className="stat-label">{memberName(person.userId)}</p>
                <p className="stat-value" style={{ fontSize: "0.95rem" }}>
                  {formatCurrency(Number(person.total))}
                </p>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginTop: "0.9rem", width: "100%" }}
          onClick={() => toggleExpand(card)}
        >
          {isExpanded ? "Fechar fatura" : "Ver fatura"}
        </button>

        {isExpanded && (
          <div style={{ marginTop: "0.9rem" }}>
            <div className="field" style={{ marginBottom: "0.75rem" }}>
              <label htmlFor={`statement-month-${card.id}`}>Fatura de</label>
              <input
                id={`statement-month-${card.id}`}
                type="month"
                value={statementMonth}
                onChange={(e) => handleMonthChange(card.id, e.target.value)}
              />
            </div>

            {isLoadingStatement || !statement ? (
              <p className="loading-page" style={{ padding: "1rem 0" }}>
                Carregando...
              </p>
            ) : (
              <>
                <div className="section-header">
                  <p className="card-subtitle" style={{ marginBottom: 0 }}>
                    Total: <strong>{formatCurrency(Number(statement.total))}</strong> · vence{" "}
                    {monthYearLabel(statement.month)}
                  </p>
                  {statement.purchases.length > 0 && (
                    <button type="button" className="btn-icon" onClick={() => handleToggleStatementPaid(card)}>
                      {statement.isPaid ? "Desmarcar paga" : "Marcar como paga"}
                    </button>
                  )}
                </div>

                <ul className="transaction-list">
                  {statement.purchases.map((purchase) => {
                    const category = categories.find((c) => c.id === purchase.categoryId);
                    return (
                      <li key={purchase.id} className="transaction-row">
                        <span className="transaction-icon">{category?.emoji ?? "🧾"}</span>
                        <div className="transaction-info">
                          <span className="transaction-desc">
                            <span className="text-truncate">{purchase.description}</span>
                            {purchase.installmentsCount > 1 && (
                              <span className="badge installment-badge">
                                {purchase.installmentNumber}/{purchase.installmentsCount}
                              </span>
                            )}
                          </span>
                          <span className="transaction-meta">
                            {memberName(purchase.buyerId)} · {category?.name ?? "Sem categoria"}
                          </span>
                        </div>
                        <span className="transaction-amount expense">
                          −{formatCurrency(Number(purchase.amount))}
                        </span>
                        {!statement.isPaid && (
                          <div className="transaction-row-actions">
                            <button
                              type="button"
                              className="btn-icon"
                              title="Remover compra"
                              onClick={() => handleDeletePurchase(card.id, purchase.id)}
                            >
                              <Icon name="trash" />
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {statement.purchases.length === 0 && (
                    <p className="empty-state">Nenhuma compra lançada nessa fatura ainda.</p>
                  )}
                </ul>

                {!statement.isPaid && (
                  <>
                    {isAddingPurchase ? (
                      <form onSubmit={(e) => handleAddPurchase(e, card.id)} style={{ marginTop: "0.75rem" }}>
                        <div className="field">
                          <label htmlFor={`purchase-desc-${card.id}`}>O que foi</label>
                          <input
                            id={`purchase-desc-${card.id}`}
                            value={purchaseDescription}
                            onChange={(e) => setPurchaseDescription(e.target.value)}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`purchase-amount-${card.id}`}>Valor (R$)</label>
                          <input
                            id={`purchase-amount-${card.id}`}
                            inputMode="decimal"
                            placeholder="0,00"
                            value={purchaseAmount}
                            onChange={(e) => setPurchaseAmount(e.target.value)}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`purchase-buyer-${card.id}`}>Quem comprou</label>
                          <select
                            id={`purchase-buyer-${card.id}`}
                            value={purchaseBuyerId}
                            onChange={(e) => setPurchaseBuyerId(e.target.value)}
                          >
                            {(card.scope === "joint" ? members : members.filter((m) => m.id === user?.id)).map(
                              (member) => (
                                <option key={member.id} value={member.id}>
                                  {member.id === user?.id ? "Você" : member.displayName}
                                </option>
                              )
                            )}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`purchase-category-${card.id}`}>Categoria (opcional)</label>
                          <select
                            id={`purchase-category-${card.id}`}
                            value={purchaseCategoryId}
                            onChange={(e) => setPurchaseCategoryId(e.target.value)}
                          >
                            <option value="">Sem categoria</option>
                            {categories.map((category) => (
                              <option key={category.id} value={category.id}>
                                {category.emoji ?? ""} {category.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`purchase-date-${card.id}`}>Data</label>
                          <input
                            id={`purchase-date-${card.id}`}
                            type="date"
                            value={purchaseDate}
                            onChange={(e) => setPurchaseDate(e.target.value)}
                            required
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`purchase-installments-${card.id}`}>Parcelas</label>
                          <select
                            id={`purchase-installments-${card.id}`}
                            value={purchaseInstallments}
                            onChange={(e) => setPurchaseInstallments(e.target.value)}
                          >
                            {INSTALLMENT_OPTIONS.map((count) => (
                              <option key={count} value={count}>
                                {count === 1 ? "1x (à vista)" : `${count}x`}
                              </option>
                            ))}
                          </select>
                          {card.limit !== null && Number(purchaseInstallments) > 1 && (
                            <p className="field-hint">
                              O valor total trava no limite agora -- só libera conforme cada fatura mensal é paga.
                            </p>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "0.5rem" }}>
                          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                            {isSubmitting ? "Salvando..." : "Lançar compra"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setIsAddingPurchase(false)}
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ marginTop: "0.75rem", width: "100%" }}
                        onClick={() => setIsAddingPurchase(true)}
                      >
                        + Lançar compra
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const jointCards = cards?.filter((c) => c.scope === "joint") ?? [];
  const personalCards = cards?.filter((c) => c.scope === "personal") ?? [];
  // With no card yet the form IS the page; once there's one, the cards come
  // first (on a phone the form used to push them a full screen down) and
  // the form opens from the button.
  const showCreateForm = isCreateOpen || cards?.length === 0;

  return (
    <AppLayout>
      <div className="page-stack">
        <BillsTabs />
        <div className="section-header">
          <div>
            <h1>Cartões</h1>
            <p className="card-subtitle">Faturas, limite e quem comprou o quê.</p>
          </div>
          {cards !== null && cards.length > 0 && !isCreateOpen && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setIsCreateOpen(true)}>
              + Novo cartão
            </button>
          )}
        </div>

        {showCreateForm && (
        <div className="card form-card">
          <div className="section-header">
            <p className="card-title">Novo cartão</p>
            {cards !== null && cards.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setIsCreateOpen(false)}>
                Cancelar
              </button>
            )}
          </div>
          <form onSubmit={handleCreate}>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${scope === "joint" ? " active" : ""}`}
                onClick={() => setScope("joint")}
              >
                Do grupo
              </button>
              <button
                type="button"
                className={`segmented-option${scope === "personal" ? " active" : ""}`}
                onClick={() => setScope("personal")}
              >
                Pessoal
              </button>
            </div>

            <div className="field">
              <label htmlFor="card-name">Nome do cartão</label>
              <input id="card-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="card-closing">Dia de fechamento</label>
              <input
                id="card-closing"
                type="number"
                min={1}
                max={31}
                value={closingDay}
                onChange={(e) => setClosingDay(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="card-due">Dia de vencimento</label>
              <input
                id="card-due"
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={(e) => setDueDay(e.target.value)}
              />
            </div>

            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${limitType === "normal" ? " active" : ""}`}
                onClick={() => setLimitType("normal")}
              >
                Limite normal
              </button>
              <button
                type="button"
                className={`segmented-option${limitType === "secured" ? " active" : ""}`}
                onClick={() => setLimitType("secured")}
              >
                Limite garantido
              </button>
            </div>

            <div className="field">
              <label htmlFor="card-limit">
                {limitType === "secured" ? "Quanto você guardou no cartão (R$)" : "Limite (opcional)"}
              </label>
              <input
                id="card-limit"
                inputMode="decimal"
                placeholder="0,00"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="field-hint">
                {limitType === "secured"
                  ? "Esse valor sai da sua conta hoje e vira o limite do cartão. Continua sendo seu: dá pra guardar mais ou resgatar depois."
                  : "Se preencher, a gente acompanha quanto do limite já está comprometido."}
              </p>
            </div>

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Adicionar cartão"}
            </button>
          </form>
        </div>
        )}

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            💞 Cartões do grupo
          </p>
          {cards === null ? null : jointCards.length === 0 ? (
            <EmptyState icon="🧾">Nenhum cartão do casal cadastrado ainda.</EmptyState>
          ) : (
            <div className="page-stack">{jointCards.map(renderCard)}</div>
          )}
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            👤 Seus cartões pessoais
          </p>
          {cards === null ? null : personalCards.length === 0 ? (
            <EmptyState icon="💳">Nenhum cartão pessoal cadastrado ainda.</EmptyState>
          ) : (
            <div className="page-stack">{personalCards.map(renderCard)}</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
