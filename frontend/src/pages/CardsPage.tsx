import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency, monthYearLabel, parseLocalDate } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";
import { useConfirm } from "../components/ConfirmDialog";
import { useToast } from "../components/ToastProvider";
import { BillsTabs } from "../components/BillsTabs";
import { SplitSummary } from "../components/SplitSummary";
import { personColor } from "../utils/categoryColor";
import { readCreditCardPreference, saveCreditCardPreference } from "../utils/creditCardPreference";

interface MemberRow {
  id: string;
  displayName: string;
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
  securedFromAccount: boolean;
  limitReleases: LimitRelease[];
}

interface LimitRelease {
  month: string;
  dueDate: string;
  amount: string;
  availableAfter: string;
}

export function CardsPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const cacheKey = `cards:${user?.id ?? "anon"}`;

  const [cards, setCards] = useState<CardRow[] | null>(() => readCache(cacheKey));
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [closingDay, setClosingDay] = useState("28");
  const [dueDay, setDueDay] = useState("5");
  const [limit, setLimit] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [limitType, setLimitType] = useState<"normal" | "secured">("normal");
  // Cartão garantido: o dinheiro sai da conta hoje, ou já estava guardado
  // fora do app (poupança/caixinha) e o limite é um valor a mais.
  // Sem padrão de propósito: as duas situações são comuns e escolher errado
  // deixa o saldo da conta errado, então a pessoa responde.
  const [securedFromAccount, setSecuredFromAccount] = useState<boolean | null>(null);
  const [defaultCreditCardId, setDefaultCreditCardId] = useState(() => readCreditCardPreference(user?.id ?? ""));
  const [scope, setScope] = useState<"personal" | "joint">("joint");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // "Guardar mais" / "Resgatar" num cartão com limite garantido -- um
  // formulário na linha por vez, ligado ao cartão que abriu.
  const [limitAdjust, setLimitAdjust] = useState<{ cardId: string; direction: "deposit" | "withdraw" } | null>(null);
  const [limitAdjustAmount, setLimitAdjustAmount] = useState("");
  const [limitAdjustError, setLimitAdjustError] = useState<string | null>(null);

  async function loadCards() {
    try {
      const result = await apiRequest<CardRow[]>("/cards", { token });
      setCards(result);
      writeCache(cacheKey, result);
    } catch (err) {
      // Deixa `cards` como estava (do cache ou null) -- as seções de "vazio" abaixo
      // só aparecem quando `cards` não é null, então uma falha ao carregar nunca é
      // confundida com "confirmado: nenhum cartão".
      setError(err instanceof ApiError ? err.message : "Não foi possível carregar os cartões");
    }
  }

  useEffect(() => {
    loadCards();
    apiRequest<{ members: MemberRow[] }>("/groups/me", { token }).then((res) => setMembers(res.members));
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
    if (limitType === "secured" && securedFromAccount === null) {
      setError("Conte de onde veio o dinheiro do limite: da sua conta ou de outro lugar.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/cards", {
        method: "POST",
        token,
        body: {
          name: name.trim(),
          closingDay: parsedClosing,
          dueDay: parsedDue,
          scope,
          limit: parsedLimit,
          limitType,
          securedFromAccount: limitType === "secured" ? securedFromAccount : undefined,
        },
      });
      setName("");
      setClosingDay("28");
      setDueDay("5");
      setLimit("");
      setLimitType("normal");
      setSecuredFromAccount(null);
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
      showToast("Cartão excluído");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover o cartão");
    }
  }

  function toggleDefaultCreditCard(cardId: string) {
    const next = defaultCreditCardId === cardId ? null : cardId;
    saveCreditCardPreference(user?.id ?? "", next);
    setDefaultCreditCardId(next);
    showToast(next ? "Compras no crédito vão pra esse cartão" : "Cartão padrão removido", next ? undefined : { variant: "info" });
  }

  async function handleSecuredSource(card: CardRow, fromAccount: boolean) {
    const confirmed = await confirm({
      title: fromAccount ? "Esse dinheiro saiu da sua conta?" : "Esse dinheiro já estava guardado?",
      body: fromAccount
        ? `A gente tira ${formatCurrency(Number(card.limit ?? 0))} da sua conta hoje, como guardado no cartão.`
        : "Os lançamentos de guardar e resgatar somem do extrato e o saldo da conta volta ao que era. O limite continua igual.",
      confirmLabel: fromAccount ? "Tirar da conta" : "Não mexer na conta",
    });
    if (!confirmed) return;
    try {
      await apiRequest(`/cards/${card.id}/secured-source`, { method: "PATCH", token, body: { fromAccount } });
      showToast(fromAccount ? "Tirado da conta" : "Conta corrigida");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar o cartão");
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

  // Cadastrar / mudar o limite de um cartão normal (o garantido muda por
  // Guardar mais / Resgatar).
  const [limitEditId, setLimitEditId] = useState<string | null>(null);
  const [limitEditValue, setLimitEditValue] = useState("");
  const [isSavingLimit, setIsSavingLimit] = useState(false);

  function startLimitEdit(card: CardRow) {
    setLimitEditId(card.id);
    setLimitEditValue(card.limit !== null ? String(Number(card.limit)).replace(".", ",") : "");
  }

  async function saveLimit(event: FormEvent, card: CardRow) {
    event.preventDefault();
    const raw = limitEditValue.trim();
    const value = raw === "" ? null : Number(raw.replace(/\./g, "").replace(",", "."));
    if (value !== null && !(value > 0)) {
      setError("O limite precisa ser um valor maior que zero.");
      return;
    }
    setIsSavingLimit(true);
    try {
      await apiRequest(`/cards/${card.id}`, {
        method: "PATCH",
        token,
        body: { name: card.name, closingDay: card.closingDay, dueDay: card.dueDay, limit: value },
      });
      setLimitEditId(null);
      showToast(value === null ? "Limite removido" : "Limite salvo");
      await loadCards();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o limite");
    } finally {
      setIsSavingLimit(false);
    }
  }

  function renderLimitForm(card: CardRow) {
    return (
      <form className="limit-adjust-form" onSubmit={(e) => void saveLimit(e, card)}>
        <div className="field">
          <label htmlFor={`limit-edit-${card.id}`}>Limite do cartão (R$)</label>
          <input
            id={`limit-edit-${card.id}`}
            inputMode="decimal"
            placeholder="Ex.: 3.000,00 (vazio = sem limite)"
            value={limitEditValue}
            onChange={(e) => setLimitEditValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className="limit-adjust-actions">
          <button type="button" className="btn btn-outline" onClick={() => setLimitEditId(null)}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSavingLimit}>
            {isSavingLimit ? "Salvando..." : "Salvar limite"}
          </button>
        </div>
      </form>
    );
  }

  function renderCard(card: CardRow) {
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
            {card.name}
            {defaultCreditCardId === card.id && <span className="card-default-badge">Padrão no crédito</span>}
          </p>
          <div className="transaction-row-actions">
            <button type="button" className="btn-icon" title="Remover cartão" onClick={() => handleDeleteCard(card.id)}>
              ✕
            </button>
          </div>
        </div>
        <div className="card-hero">
          <span className="card-hero-label">
            {s.isPaid ? `Fatura de ${monthYearLabel(s.month)}, paga` : `Fatura de ${monthYearLabel(s.month)}, vence dia ${card.dueDay}`}
          </span>
          <span className="card-hero-amount">{formatCurrency(Number(s.total))}</span>
        </div>

        {limitCents === null && !isSecured && (
          limitEditId === card.id ? (
            renderLimitForm(card)
          ) : (
            <button type="button" className="btn btn-outline card-limit-add" onClick={() => startLimitEdit(card)}>
              Cadastrar limite
            </button>
          )
        )}

        {limitCents !== null && limitUsedCents !== null && (
          <>
            <div className="progress-track card-limit-track">
              <div className={`progress-fill ${limitTone}`} style={{ width: `${limitPercent}%` }} />
            </div>
            <div className="card-limit-legend">
              <span className={`card-limit-percent ${limitTone}`}>
                {isSecured ? "Guardado usado" : "Limite usado"} · {Math.round(limitRawPercent)}%
              </span>
              <span>
                {formatCurrency(available)} livres de {formatCurrency(limitCents)}
              </span>
            </div>
            {!isSecured &&
              (limitEditId === card.id ? (
                renderLimitForm(card)
              ) : (
                <button type="button" className="link-button card-limit-edit" onClick={() => startLimitEdit(card)}>
                  Mudar limite
                </button>
              ))}

            {isSecured && (
              <p className="field-hint">
                {card.securedFromAccount
                  ? "Saiu da sua conta e continua seu, só fica parado como garantia."
                  : "Já estava guardado fora do app, então é limite a mais: não mexe no saldo da conta."}{" "}
                A fatura você paga com o dinheiro da conta, e pagar devolve o limite.{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => handleSecuredSource(card, !card.securedFromAccount)}
                >
                  {card.securedFromAccount ? "Não saiu da conta?" : "Saiu da conta?"}
                </button>
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
                      ? card.securedFromAccount
                        ? "Sai da sua conta hoje e vira limite na hora."
                        : "Vira limite na hora, sem mexer no saldo da conta."
                      : `${card.securedFromAccount ? "Volta pra sua conta." : "Sai do limite."} Você pode resgatar até ${formatCurrency(available)}: o que está em compras fica preso até a fatura ser paga.`}
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

            {isSecured && card.limitReleases?.length > 0 && (
              <div className="secured-outlook">
                <p className="secured-outlook-title">Como fica na próxima fatura</p>
                <ul>
                  <li>
                    <span>Guardado no cartão (continua seu)</span>
                    <strong>{formatCurrency(limitCents ?? 0)}</strong>
                  </li>
                  <li>
                    <span>
                      Fatura de {monthYearLabel(card.limitReleases[0].month)}, vence{" "}
                      {parseLocalDate(card.limitReleases[0].dueDate).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                    <strong className="owe-text">−{formatCurrency(Number(card.limitReleases[0].amount))}</strong>
                  </li>
                </ul>
                <p className="field-hint">
                  <strong>Pagando com o dinheiro da conta:</strong> o limite volta pra{" "}
                  {formatCurrency(Math.max(0, Number(card.limitReleases[0].availableAfter)))} e o guardado continua inteiro.
                </p>
                <p className="field-hint">
                  <strong>Sem pagar:</strong> o banco tira{" "}
                  {formatCurrency(Number(card.limitReleases[0].amount))} do guardado pra quitar e sobram{" "}
                  {formatCurrency(Math.max(0, (limitCents ?? 0) - Number(card.limitReleases[0].amount)))} de limite.
                </p>
              </div>
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

        <p className="card-subtitle card-closing-note">
          Fecha dia {card.closingDay}. Compras a partir daí caem na fatura seguinte.{" "}
          <button type="button" className="link-button" onClick={() => toggleDefaultCreditCard(card.id)}>
            {defaultCreditCardId === card.id ? "Deixar de ser o padrão no crédito" : "Usar nas compras no crédito"}
          </button>
        </p>

        {s.byPerson.length > 1 && (
          <SplitSummary
            title="Quem comprou o quê"
            totalSuffix="na fatura"
            payers={[...s.byPerson]
              .sort((a, b) => (a.userId === user?.id ? -1 : b.userId === user?.id ? 1 : a.userId.localeCompare(b.userId)))
              .map((person, index) => ({
                id: person.userId,
                displayName: memberName(person.userId),
                total: Number(person.total),
                color: personColor(index),
              }))}
            accountName="fatura"
            currentUserId={user?.id}
            memberName={memberName}
          />
        )}

        {/* A fatura agora tem tela própria (CardStatementPage): compras por
            dia, vencimento, limite e as faturas anteriores e seguintes. */}
        <Link to={`/cards/${card.id}/fatura`} className="btn btn-ghost" style={{ marginTop: "0.9rem", width: "100%" }}>
          Ver fatura
        </Link>
      </div>
    );
  }

  const jointCards = cards?.filter((c) => c.scope === "joint") ?? [];
  const personalCards = cards?.filter((c) => c.scope === "personal") ?? [];
  // Sem nenhum cartão ainda, o formulário É a tela; quando já existe um, os
  // cartões vêm primeiro (no celular o formulário empurrava eles uma tela
  // inteira pra baixo) e o formulário abre pelo botão.
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

            {limitType === "secured" && (
              <div className="field">
                <label>De onde veio esse dinheiro?</label>
                <div className="segmented">
                  <button
                    type="button"
                    className={`segmented-option${securedFromAccount === true ? " active" : ""}`}
                    onClick={() => setSecuredFromAccount(true)}
                  >
                    Tirei da minha conta
                  </button>
                  <button
                    type="button"
                    className={`segmented-option${securedFromAccount === false ? " active" : ""}`}
                    onClick={() => setSecuredFromAccount(false)}
                  >
                    Já estava guardado fora
                  </button>
                </div>
              </div>
            )}

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
                  ? securedFromAccount === null
                    ? "Ex.: sobrou do salário e você passou pro cartão = tirei da minha conta. Tinha numa poupança que o app não acompanha = já estava guardado fora."
                    : securedFromAccount
                      ? "Esse valor sai da sua conta hoje e vira o limite do cartão. Continua sendo seu: dá pra guardar mais ou resgatar depois."
                      : "Vira o limite do cartão sem mexer no saldo da conta. O que você comprar entra na fatura do mês seguinte."
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
            Cartões do grupo
          </p>
          {cards === null ? null : jointCards.length === 0 ? (
            <EmptyState>Nenhum cartão do casal cadastrado ainda.</EmptyState>
          ) : (
            <div className="page-stack">{jointCards.map(renderCard)}</div>
          )}
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            Seus cartões pessoais
          </p>
          {cards === null ? null : personalCards.length === 0 ? (
            <EmptyState>Nenhum cartão pessoal cadastrado ainda.</EmptyState>
          ) : (
            <div className="page-stack">{personalCards.map(renderCard)}</div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
