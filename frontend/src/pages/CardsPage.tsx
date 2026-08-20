import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { currentMonthParam, formatCurrency, monthYearLabel } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

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
}

interface PurchaseRow {
  id: string;
  description: string;
  amount: string;
  categoryId: string | null;
  buyerId: string;
  purchaseDate: string;
}

interface StatementDetail extends StatementSummary {
  purchases: PurchaseRow[];
}

export function CardsPage() {
  const { user, token } = useAuth();
  const cacheKey = `cards:${user?.id ?? "anon"}`;

  const [cards, setCards] = useState<CardRow[] | null>(() => readCache(cacheKey));
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [closingDay, setClosingDay] = useState("28");
  const [dueDay, setDueDay] = useState("5");
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
  const [isAddingPurchase, setIsAddingPurchase] = useState(false);

  async function loadCards() {
    const result = await apiRequest<CardRow[]>("/cards", { token });
    setCards(result);
    writeCache(cacheKey, result);
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
    if (!name.trim() || !(parsedClosing >= 1 && parsedClosing <= 31) || !(parsedDue >= 1 && parsedDue <= 31)) {
      setError("Informe nome, dia de fechamento e dia de vencimento (1 a 31).");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/cards", {
        method: "POST",
        token,
        body: { name: name.trim(), closingDay: parsedClosing, dueDay: parsedDue, scope },
      });
      setName("");
      setClosingDay("28");
      setDueDay("5");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o cartão");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCard(cardId: string) {
    const confirmed = window.confirm(
      "Excluir esse cartão? Isso também remove as compras e as faturas pagas geradas por ele."
    );
    if (!confirmed) return;
    try {
      await apiRequest(`/cards/${cardId}`, { method: "DELETE", token });
      if (expandedCardId === cardId) setExpandedCardId(null);
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
        },
      });
      setPurchaseDescription("");
      setPurchaseAmount("");
      setPurchaseCategoryId("");
      setIsAddingPurchase(false);
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
      await loadStatement(cardId, statementMonth);
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a compra");
    }
  }

  async function handleToggleStatementPaid(card: CardRow) {
    const isPaid = statement?.isPaid ?? card.currentStatement.isPaid;
    if (!isPaid) {
      const confirmed = window.confirm(
        `Marcar a fatura de ${monthYearLabel(statementMonth)} como paga? Isso lança uma despesa de ${formatCurrency(
          Number(statement?.total ?? card.currentStatement.total)
        )} dividida entre quem comprou o quê.`
      );
      if (!confirmed) return;
    }
    try {
      await apiRequest(`/cards/${card.id}/statements/${statementMonth}`, {
        method: "PATCH",
        token,
        body: { isPaid: !isPaid },
      });
      await loadStatement(card.id, statementMonth);
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a fatura");
    }
  }

  function memberName(userId: string) {
    if (userId === user?.id) return "Você";
    return members.find((m) => m.id === userId)?.displayName ?? "Alguém do grupo";
  }

  function renderCard(card: CardRow) {
    const isExpanded = expandedCardId === card.id;
    const s = card.currentStatement;
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
                          <span className="transaction-desc">{purchase.description}</span>
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
                              🗑
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

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="card form-card">
          <h1>Cartão conjunto</h1>
          <p className="card-subtitle">
            Um cartão de crédito usado por mais de uma pessoa? Registre aqui e saiba quem comprou o quê em
            cada fatura.
          </p>
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

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            💞 Cartões do grupo
          </p>
          {jointCards.length === 0 ? (
            <p className="empty-state">Nenhum cartão conjunto ainda.</p>
          ) : (
            <div className="page-stack">{jointCards.map(renderCard)}</div>
          )}
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            👤 Seus cartões pessoais
          </p>
          {personalCards.length === 0 ? (
            <p className="empty-state">Nenhum cartão pessoal ainda.</p>
          ) : (
            <div className="page-stack">{personalCards.map(renderCard)}</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
