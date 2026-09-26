import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { useSwipeDownToClose } from "../hooks/useSwipeDownToClose";
import { useToast } from "../components/ToastProvider";
import { saveTransactionInBackground } from "../utils/optimisticTransactions";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency } from "../utils/format";
import { PAYMENT_METHOD_OPTIONS, paymentMethodLabel, type PaymentMethod } from "../utils/paymentMethod";
import { recentDescriptions, rememberEntry, suggestFor } from "../utils/quickEntry";
import {
  readCreditCardPreference,
  resolveCreditCardPreference,
  saveCreditCardPreference,
} from "../utils/creditCardPreference";

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

interface CardOption {
  id: string;
  name: string;
}

// Mesmas opções de parcelas que a tela de Cartões aceita.
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 12];

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

export function NewTransactionPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  // Fechar sem salvar: volta pra tela de onde veio (ou pro Painel, se abriu
  // direto pelo link). Funciona pelo X, pelo Esc no PC e arrastando o card
  // pra baixo no celular.
  const close = useCallback(() => {
    if (location.key !== "default") navigate(-1);
    else navigate("/dashboard");
  }, [location.key, navigate]);
  const cardRef = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(cardRef, close);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  // O atalho "Receita" do Painel abre isso com ?tipo=receita; o "Repetir"
  // do extrato manda o lançamento inteiro na URL (utils/quickEntry.ts).
  const [prefill] = useState(() => new URLSearchParams(window.location.search));
  const isRepeat = prefill.get("repetir") === "1";
  const [transactionType, setTransactionType] = useState<"expense" | "income">(() =>
    prefill.get("tipo") === "receita" ? "income" : "expense"
  );
  const [description, setDescription] = useState(() => prefill.get("d") ?? "");
  const [amount, setAmount] = useState(() => (prefill.get("v") ? Number(prefill.get("v")).toFixed(2).replace(".", ",") : ""));
  const [accountId, setAccountId] = useState(() => prefill.get("a") ?? "");
  const [categoryId, setCategoryId] = useState(() => prefill.get("c") ?? "");
  // Depois que a pessoa escolhe a categoria na mão, a sugestão automática
  // não mexe mais nela.
  const [categoryTouched, setCategoryTouched] = useState(isRepeat);
  const [showMore, setShowMore] = useState(false);
  const [knownDescriptions] = useState(() => recentDescriptions(user?.id ?? ""));
  const [payerId, setPayerId] = useState(user?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [splitType, setSplitType] = useState<"none" | "equal">("none");
  const [isPrivate, setIsPrivate] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(() => (prefill.get("p") as PaymentMethod | null) ?? "");
  const [isRecurring, setIsRecurring] = useState(false);

  // Crédito -> cartão: na primeira compra no crédito pergunta em qual
  // cartão lançar (ou se é pra não lançar em nenhum); a resposta vira o
  // padrão das próximas, e sempre dá pra trocar aqui mesmo.
  const [cards, setCards] = useState<CardOption[]>([]);
  // null = ainda não respondeu; "none" = não lançar em cartão; senão, o id.
  const [cardChoice, setCardChoice] = useState<string | null>(null);
  const [isPickingCard, setIsPickingCard] = useState(false);
  const [installments, setInstallments] = useState("1");
  const [isSaving, setIsSaving] = useState(false);
  const [recurringMonths, setRecurringMonths] = useState("12");

  const isIncome = transactionType === "income";
  const asksForCard = !isIncome && paymentMethod === "credit" && cards.length > 0;
  const selectedCard = asksForCard ? cards.find((card) => card.id === cardChoice) ?? null : null;
  const moreOptionsSummary = [
    occurredAt === new Date().toISOString().slice(0, 10)
      ? "Hoje"
      : new Date(`${occurredAt}T00:00:00`).toLocaleDateString("pt-BR"),
    accounts.find((a) => a.id === accountId)?.name,
    payerId === user?.id
      ? isIncome
        ? "você recebeu"
        : "você pagou"
      : members.find((m) => m.id === payerId)?.displayName,
    selectedCard ? `cartão ${selectedCard.name}` : paymentMethodLabel(paymentMethod || null),
    isRecurring ? "todo mês" : null,
    !isIncome && splitType === "equal" ? "dividido" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Live preview only -- the real split (with exact-cent remainder handling)
  // is computed server-side in splitEvenly() when the transaction is saved.
  const parsedAmountPreview = Number(amount.replace(",", "."));
  const perPersonAmount =
    splitType === "equal" && members.length > 0 && parsedAmountPreview > 0
      ? parsedAmountPreview / members.length
      : null;

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryEmoji, setNewCategoryEmoji] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function loadCategories() {
    const categoriesRes = await apiRequest<CategoryRow[]>("/categories", { token });
    setCategories(categoriesRes);
    return categoriesRes;
  }

  useEffect(() => {
    async function load() {
      const [groupRes] = await Promise.all([
        apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }),
        loadCategories(),
      ]);
      setAccounts(groupRes.accounts);
      setMembers(groupRes.members);
      setAccountId(
        (current) =>
          current ||
          groupRes.accounts.find((a) => a.type === "personal" && a.ownerUserId === user?.id)?.id ||
          groupRes.accounts.find((a) => a.type === "joint")?.id ||
          ""
      );
      setPayerId((current) => current || user?.id || "");
    }
    load();
    apiRequest<CardOption[]>("/cards", { token })
      .then((result) => {
        const options = result.map((card) => ({ id: card.id, name: card.name }));
        setCards(options);
        setCardChoice(
          resolveCreditCardPreference(
            readCreditCardPreference(user?.id ?? ""),
            options.map((card) => card.id)
          )
        );
      })
      .catch(() => setCards([]));
  }, [token, user?.id]);

  function handleDescriptionChange(value: string) {
    setDescription(value);
    if (categoryTouched) return;
    const suggestion = suggestFor(user?.id ?? "", value);
    if (!suggestion) return;
    if (suggestion.categoryId && categories.some((c) => c.id === suggestion.categoryId)) setCategoryId(suggestion.categoryId);
    if (suggestion.paymentMethod) setPaymentMethod(suggestion.paymentMethod);
    if (suggestion.accountId && accounts.some((a) => a.id === suggestion.accountId)) setAccountId(suggestion.accountId);
  }

  async function handleAddCategory() {
    if (!newCategoryName.trim()) return;
    setError(null);
    setIsSavingCategory(true);
    try {
      const created = await apiRequest<CategoryRow>("/categories", {
        method: "POST",
        token,
        body: { name: newCategoryName.trim(), emoji: newCategoryEmoji.trim() || null },
      });
      await loadCategories();
      setCategoryId(created.id);
      setCategoryTouched(true);
      setNewCategoryName("");
      setNewCategoryEmoji("");
      setIsAddingCategory(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a categoria");
    } finally {
      setIsSavingCategory(false);
    }
  }

  function chooseCard(value: string) {
    setCardChoice(value);
    setIsPickingCard(false);
    saveCreditCardPreference(user?.id ?? "", value);
  }

  async function saveCardPurchase(card: CardOption, parsedAmount: number) {
    setIsSaving(true);
    try {
      await apiRequest(`/cards/${card.id}/purchases`, {
        method: "POST",
        token,
        body: {
          description: description.trim(),
          amount: parsedAmount,
          categoryId: categoryId || null,
          buyerId: payerId,
          purchaseDate: occurredAt,
          installments: Number(installments),
        },
      });
      showToast(`Compra lançada no cartão ${card.name}`, {
        description: Number(installments) > 1 ? `Em ${installments}x, uma parcela por fatura` : "Entra na fatura do cartão",
      });
      navigate("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "A fatura desse mês já foi paga. Mude a data ou reabra a fatura em Cartões."
          : err instanceof ApiError
            ? err.message
            : "Não foi possível lançar no cartão"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount.replace(",", "."));
    const parsedMonths = Number(recurringMonths);
    if (!description.trim() || !accountId || !payerId || !occurredAt || !(parsedAmount > 0)) {
      setError("Preencha descrição, valor, conta e pagador.");
      return;
    }
    if (isRecurring && (!Number.isInteger(parsedMonths) || parsedMonths < 2 || parsedMonths > 36)) {
      setError("A repetição precisa ser entre 2 e 36 meses.");
      return;
    }

    if (asksForCard && cardChoice === null) {
      setError("Escolha se a compra vai pra algum cartão.");
      return;
    }
    if (selectedCard) {
      rememberEntry(user?.id ?? "", {
        description,
        categoryId: categoryId || null,
        accountId,
        paymentMethod: paymentMethod || null,
      });
      await saveCardPurchase(selectedCard, parsedAmount);
      return;
    }

    // Optimistic save: leave the form and show the result right away, the
    // POST finishes in the background (and offers "Tentar de novo" if the
    // server rejects it) -- see utils/optimisticTransactions.ts.
    const account = accounts.find((a) => a.id === accountId);
    const category = categories.find((c) => c.id === categoryId);
    rememberEntry(user?.id ?? "", {
      description,
      categoryId: categoryId || null,
      accountId,
      paymentMethod: paymentMethod || null,
    });
    const payload = {
      description: description.trim(),
      amount: parsedAmount,
      accountId,
      categoryId: categoryId || null,
      payerId,
      transactionType,
      occurredAt,
      splitType: isIncome ? "none" : splitType,
      isPrivate: isIncome ? false : isPrivate,
      paymentMethod: paymentMethod || null,
      recurringMonths: isRecurring ? parsedMonths : null,
    };
    saveTransactionInBackground({
      token,
      userId: user?.id ?? "",
      payload,
      showToast,
      optimistic: {
        id: `pending-${Date.now()}`,
        description: payload.description,
        amount: String(parsedAmount),
        transactionType,
        occurredAt,
        categoryId: categoryId || null,
        categoryName: category?.name ?? null,
        categoryEmoji: category?.emoji ?? null,
        isPrivate: payload.isPrivate,
        recurringGroupId: null,
        splitType: payload.splitType,
        isSettled: false,
        accountId,
        accountType: account?.type ?? "personal",
        paymentMethod: paymentMethod || null,
        payerId,
      },
    });
    showToast(
      isRecurring ? `${isIncome ? "Receita" : "Despesa"} recorrente salva` : isIncome ? "Receita salva" : "Despesa salva",
      isRecurring ? { description: `Repete por ${parsedMonths} meses` } : undefined
    );
    navigate("/dashboard");
  }

  return (
    <AppLayout>
      <div className="card form-card sheet-card" ref={cardRef}>
        <span className="sheet-handle" data-swipe-handle aria-hidden="true" />
        <div className="sheet-head" data-swipe-handle>
          <h1>{isIncome ? "Nova entrada" : "Nova despesa"}</h1>
          <button type="button" className="sheet-close" onClick={close} aria-label="Fechar" title="Fechar (Esc)">
            <Icon name="x" />
          </button>
        </div>
        <p className="card-subtitle">
          {isIncome ? "Registre um valor recebido pelo grupo ou pessoal." : "Registre um gasto do grupo ou pessoal."}
        </p>

        <div className="segmented">
          <button
            type="button"
            className={`segmented-option${!isIncome ? " active" : ""}`}
            onClick={() => setTransactionType("expense")}
          >
            Despesa
          </button>
          <button
            type="button"
            className={`segmented-option${isIncome ? " active" : ""}`}
            onClick={() => setTransactionType("income")}
          >
            Receita
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="amount">Valor (R$)</label>
            <input
              id="amount"
              className="amount-input"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus={!isRepeat}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="description">Descrição</label>
            <input
              id="description"
              value={description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              list="known-descriptions"
              autoComplete="off"
              required
            />
            <datalist id="known-descriptions">
              {knownDescriptions.map((text) => (
                <option key={text} value={text} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <div className="field-label-row">
              <label htmlFor="category">Categoria</label>
              <button
                type="button"
                className="link-button"
                onClick={() => setIsAddingCategory((current) => !current)}
              >
                {isAddingCategory ? "Cancelar" : "+ Nova categoria"}
              </button>
            </div>
            <select id="category" value={categoryId} onChange={(e) => {
                setCategoryId(e.target.value);
                setCategoryTouched(true);
              }}>
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            {isAddingCategory && (
              <div className="inline-add-row">
                <input
                  placeholder="Nome"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={isSavingCategory || !newCategoryName.trim()}
                  onClick={handleAddCategory}
                >
                  {isSavingCategory ? "..." : "Adicionar"}
                </button>
              </div>
            )}
          </div>

          {/* O resto já vem preenchido (hoje, sua conta, você pagou). Fica
              escondido pra o lançamento do dia a dia caber numa tela. */}
          <button
            type="button"
            className="more-options-toggle"
            aria-expanded={showMore}
            onClick={() => setShowMore((current) => !current)}
          >
            <span>
              <strong>Mais opções</strong>
              <small>{moreOptionsSummary}</small>
            </span>
            <Icon name="chevron" />
          </button>

          {showMore && (
            <div className="more-options">
              <div className="field">
                <label htmlFor="occurredAt">Data</label>
                <input
                  id="occurredAt"
                  type="date"
                  value={occurredAt}
                  onChange={(e) => setOccurredAt(e.target.value)}
                  required
                />
              </div>

            <div className="field">
              <label htmlFor="account">Conta</label>
              <select id="account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
                <option value="" disabled>
                  Selecione
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="payer">{isIncome ? "Quem recebeu" : "Quem pagou"}</label>
              <select id="payer" value={payerId} onChange={(e) => setPayerId(e.target.value)} required>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.id === user?.id ? "Você" : member.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="payment-method">{isIncome ? "Forma de recebimento" : "Forma de pagamento"} (opcional)</label>
              <select
                id="payment-method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | "")}
              >
                <option value="">Não informado</option>
                {PAYMENT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {!selectedCard && (
            <label className="checkbox-field">
              <input type="checkbox" checked={isRecurring} onChange={(e) => setIsRecurring(e.target.checked)} />
              {isIncome ? "Entrada recorrente (salário)" : "Repete todo mês (assinatura)"}
            </label>
            )}
            {isRecurring && !selectedCard && (
              <div className="field">
                <label htmlFor="recurringMonths">Repetir por quantos meses</label>
                <input
                  id="recurringMonths"
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={36}
                  value={recurringMonths}
                  onChange={(e) => setRecurringMonths(e.target.value)}
                />
                <p className="field-hint">
                  Lança {description.trim() ? `"${description.trim()}"` : "esse valor"} todo mês, a partir de{" "}
                  {occurredAt ? new Date(`${occurredAt}T00:00:00`).toLocaleDateString("pt-BR") : "hoje"}, já de uma vez.
                </p>
              </div>
            )}

            {!isIncome && !selectedCard && (
              <>
                <div className="field">
                  <label htmlFor="split">Divisão</label>
                  <select
                    id="split"
                    value={splitType}
                    onChange={(e) => setSplitType(e.target.value as "none" | "equal")}
                  >
                    <option value="none">Não dividir</option>
                    <option value="equal">Dividir igualmente entre o grupo</option>
                  </select>
                  {splitType === "equal" && (
                    <p className="field-hint">
                      {members.length > 1
                        ? `${members.length} pessoas no grupo${
                            perPersonAmount !== null ? ` — ${formatCurrency(perPersonAmount)} cada` : ""
                          }.`
                        : "Só tem você no grupo por enquanto — convide alguém pra dividir de verdade."}
                    </p>
                  )}
                </div>

                <label className="checkbox-field">
                  <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                  Privada (só você vê o nome)
                </label>
              </>
            )}
            </div>
          )}

          {asksForCard && (
            <div className="credit-card-link">
              {cardChoice === null ? (
                <>
                  <p className="credit-card-link-question">Quer lançar essa compra num cartão?</p>
                  <div className="chip-row">
                    {cards.map((card) => (
                      <button key={card.id} type="button" className="filter-chip" onClick={() => chooseCard(card.id)}>
                        {cards.length === 1 ? `Sim, no ${card.name}` : card.name}
                      </button>
                    ))}
                    <button type="button" className="filter-chip" onClick={() => chooseCard("none")}>
                      Não, só registrar
                    </button>
                  </div>
                  <p className="field-hint">A gente lembra a resposta pras próximas compras no crédito.</p>
                </>
              ) : (
                <>
                  <div className="credit-card-link-row">
                    <span>
                      {selectedCard ? (
                        <>
                          Vai pro cartão <strong>{selectedCard.name}</strong>
                        </>
                      ) : (
                        "Não vai pra nenhum cartão"
                      )}
                    </span>
                    <button type="button" className="link-button" onClick={() => setIsPickingCard((current) => !current)}>
                      {isPickingCard ? "Fechar" : "Trocar"}
                    </button>
                  </div>
                  {isPickingCard && (
                    <div className="field">
                      <label htmlFor="credit-card">Cartão das compras no crédito</label>
                      <select id="credit-card" value={cardChoice} onChange={(e) => chooseCard(e.target.value)}>
                        {cards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                          </option>
                        ))}
                        <option value="none">Não lançar em cartão</option>
                      </select>
                      <p className="field-hint">Vira o padrão das próximas compras no crédito.</p>
                    </div>
                  )}
                  {selectedCard && (
                    <div className="field">
                      <label htmlFor="installments">Parcelas</label>
                      <select id="installments" value={installments} onChange={(e) => setInstallments(e.target.value)}>
                        {INSTALLMENT_OPTIONS.map((count) => (
                          <option key={count} value={count}>
                            {count === 1 ? "À vista" : `${count}x`}
                          </option>
                        ))}
                      </select>
                      <p className="field-hint">
                        Entra na fatura do cartão, não no saldo da conta agora: sai da conta quando você pagar a fatura.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Salvando..." : selectedCard ? "Lançar no cartão" : isIncome ? "Salvar entrada" : "Salvar despesa"}
          </button>
        </form>
      </div>
    </AppLayout>
  );
}
