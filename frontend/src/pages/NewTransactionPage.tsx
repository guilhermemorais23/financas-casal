import { useCallback, useEffect, useRef, useState, type FormEvent, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "../components/Icon";
import { useSwipeDownToClose } from "../hooks/useSwipeDownToClose";
import { useToast } from "../components/ToastProvider";
import { PENDING_ID_PREFIX, saveTransactionInBackground } from "../utils/optimisticTransactions";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency, todayISO } from "../utils/format";
import {
  PAYMENT_METHOD_OPTIONS,
  paymentMethodLabel,
  readLastPaymentMethod,
  saveLastPaymentMethod,
  type PaymentMethod,
} from "../utils/paymentMethod";
import { recentDescriptions, rememberEntry, suggestFor } from "../utils/quickEntry";
import {
  readCreditCardPreference,
  resolveCreditCardPreference,
  saveCreditCardPreference,
} from "../utils/creditCardPreference";
import { categoriesFor, defaultCategoryFor, type CategoryType } from "../utils/categories";
import { parseMoney, toMoneyInput } from "../utils/money";

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
  type?: CategoryType;
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
  const [amount, setAmount] = useState(() => (prefill.get("v") ? toMoneyInput(Number(prefill.get("v"))) : ""));
  const [accountId, setAccountId] = useState(() => prefill.get("a") ?? "");
  const [categoryId, setCategoryId] = useState(() => prefill.get("c") ?? "");
  // Depois que a pessoa escolhe a categoria na mão, a sugestão automática
  // não mexe mais nela. O ref deixa a resposta do servidor (que chega
  // depois) saber disso na hora em que chega.
  const [categoryTouched, setCategoryTouchedState] = useState(isRepeat);
  const categoryTouchedRef = useRef(isRepeat);
  function setCategoryTouched(touched: boolean) {
    categoryTouchedRef.current = touched;
    setCategoryTouchedState(touched);
  }
  // A categoria marcada veio de uma sugestão (mostra o selo "sugerida").
  const [categorySuggested, setCategorySuggested] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [knownDescriptions] = useState(() => recentDescriptions(user?.id ?? ""));
  const [payerId, setPayerId] = useState(user?.id ?? "");
  const [occurredAt, setOccurredAt] = useState(() => todayISO());
  // "Dividir" dos Primeiros passos abre já com a divisão ligada.
  const [splitType, setSplitType] = useState<"none" | "equal">(() => (prefill.get("dividir") === "1" ? "equal" : "none"));
  const [isPrivate, setIsPrivate] = useState(false);
  // Vem do "Repetir" (p=) ou é a última forma que a pessoa usou.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(
    () => (prefill.get("p") as PaymentMethod | null) ?? (user ? readLastPaymentMethod(user.id) : null) ?? ""
  );
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
    occurredAt === todayISO()
      ? "Hoje"
      : new Date(`${occurredAt}T00:00:00`).toLocaleDateString("pt-BR"),
    accounts.find((a) => a.id === accountId)?.name,
    paymentMethod ? paymentMethodLabel(paymentMethod) : null,
    payerId === user?.id
      ? isIncome
        ? "você recebeu"
        : "você pagou"
      : members.find((m) => m.id === payerId)?.displayName,

    isRecurring ? "todo mês" : null,
    !isIncome && splitType === "equal" ? "dividido" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Só a prévia na tela -- a divisão de verdade (com o tratamento exato dos
  // centavos que sobram) é calculada no servidor pelo splitEvenly() quando o
  // lançamento é salvo.
  const parsedAmountPreview = parseMoney(amount);
  const perPersonAmount =
    splitType === "equal" && members.length > 0 && parsedAmountPreview > 0
      ? parsedAmountPreview / members.length
      : null;

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryEmoji, setNewCategoryEmoji] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Receita mostra só as categorias de receita (começa com "Receita" marcada);
  // despesa, só as de despesa.
  const typedCategories = useMemo(() => categoriesFor(categories, transactionType), [categories, transactionType]);
  const typedCategoriesRef = useRef(typedCategories);
  typedCategoriesRef.current = typedCategories;
  useEffect(() => {
    if (categories.length === 0) return;
    setCategoryId((current) => {
      if (current && typedCategories.some((category) => category.id === current)) return current;
      return defaultCategoryFor(categories, transactionType);
    });
  }, [categories, typedCategories, transactionType]);

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

  // Sugestão do servidor (histórico do grupo e palavras-chave), ~300 ms
  // depois que a pessoa para de digitar. Só pré-seleciona: escolheu na mão,
  // a sugestão não mexe mais.
  const suggestSeq = useRef(0);
  useEffect(() => {
    const text = description.trim();
    if (categoryTouched || text.length < 2) return;
    const timer = window.setTimeout(() => {
      const seq = ++suggestSeq.current;
      apiRequest<{ categoryId: string | null; source: "history" | "keyword" | null }>(
        `/categories/suggest?description=${encodeURIComponent(text)}&type=${transactionType}`,
        { token }
      )
        .then((res) => {
          if (seq !== suggestSeq.current || categoryTouchedRef.current || !res?.categoryId) return;
          const suggested = res.categoryId;
          if (!typedCategoriesRef.current.some((c) => c.id === suggested)) return;
          setCategoryId(suggested);
          setCategorySuggested(true);
        })
        .catch(() => {
          // Sem sugestão: fica a categoria que já estava.
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [description, transactionType, categoryTouched, token]);

  function handleDescriptionChange(value: string) {
    setDescription(value);
    if (categoryTouched) return;
    const suggestion = suggestFor(user?.id ?? "", value);
    if (!suggestion) return;
    if (suggestion.categoryId && typedCategories.some((c) => c.id === suggestion.categoryId)) {
      setCategoryId(suggestion.categoryId);
      setCategorySuggested(true);
    }
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
        body: { name: newCategoryName.trim(), emoji: newCategoryEmoji.trim() || null, type: transactionType },
      });
      await loadCategories();
      setCategoryId(created.id);
      setCategoryTouched(true);
      setCategorySuggested(false);
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

    const parsedAmount = parseMoney(amount);
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
      saveLastPaymentMethod(user?.id ?? "", "credit");
      await saveCardPurchase(selectedCard, parsedAmount);
      return;
    }

    // Gravação otimista: sai do formulário e mostra o resultado na hora, o POST
    // termina em segundo plano (e oferece "Tentar de novo" se o servidor
    // recusar) -- ver utils/optimisticTransactions.ts.
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
        id: `${PENDING_ID_PREFIX}${Date.now()}`,
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
    saveLastPaymentMethod(user?.id ?? "", paymentMethod || null);
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
          {/* Valor primeiro, grande e já com o cursor: o lançamento do dia a
              dia é valor, o que foi e salvar. */}
          <div className="field">
            <label htmlFor="amount">Valor (R$)</label>
            <input
              id="amount"
              className="amount-input amount-input-hero"
              inputMode="decimal"
              placeholder="0,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus={!isRepeat}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="description">{isIncome ? "De onde veio" : "Com o quê"}</label>
            <input
              id="description"
              placeholder={isIncome ? "Ex.: salário" : "Ex.: mercado"}
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
              <label htmlFor="category">
                Categoria
                {categorySuggested && !categoryTouched && <span className="badge suggested-badge">sugerida</span>}
              </label>
              <button
                type="button"
                className="link-button"
                onClick={() => setIsAddingCategory((current) => !current)}
              >
                {isAddingCategory ? "Cancelar" : isIncome ? "+ Nova fonte de receita" : "+ Nova categoria"}
              </button>
            </div>
            <select id="category" value={categoryId} onChange={(e) => {
                setCategoryId(e.target.value);
                setCategoryTouched(true);
                setCategorySuggested(false);
              }}>
              <option value="">Sem categoria</option>
              {typedCategories.map((category) => (
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

          {/* Com mais gente no grupo, dividir é um toque (divisão igual). */}
          {!isIncome && !selectedCard && members.length > 1 && (
            <div className="field split-chip-field">
              <button
                type="button"
                className={`filter-chip split-chip${splitType === "equal" ? " active" : ""}`}
                aria-pressed={splitType === "equal"}
                onClick={() => setSplitType((current) => (current === "equal" ? "none" : "equal"))}
              >
                <Icon name="users" />
                {members.length === 2
                  ? `Dividir com ${members.find((m) => m.id !== user?.id)?.displayName ?? "seu par"}`
                  : "Dividir com o grupo"}
              </button>
              {splitType === "equal" && perPersonAmount !== null && (
                <p className="field-hint">{formatCurrency(perPersonAmount)} pra cada um.</p>
              )}
            </div>
          )}

          {/* O resto já vem preenchido (hoje, sua conta, você pagou, a última
              forma de pagamento). Fica escondido pra o lançamento do dia a dia
              caber numa tela. */}
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
                <span className="field-label" id="payment-label">
                  {isIncome ? "Como recebeu" : "Como pagou"}
                </span>
                <div className="chip-row payment-chips" role="group" aria-labelledby="payment-label">
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`filter-chip${paymentMethod === option.value ? " active" : ""}`}
                      aria-pressed={paymentMethod === option.value}
                      // Só marca: a tela já abre com a última forma usada marcada, e
                      // tocar nela de novo desmarcava -- o Crédito sumia e a compra
                      // era salva sem ir pro cartão. Pra trocar, toca em outra.
                      onClick={() => setPaymentMethod(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

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
                  Já lança todos os meses, a partir de{" "}
                  {occurredAt ? new Date(`${occurredAt}T00:00:00`).toLocaleDateString("pt-BR") : "hoje"}.
                </p>
              </div>
            )}

            {!isIncome && !selectedCard && (
              <label className="checkbox-field">
                <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
                Privada (só você vê o nome)
              </label>
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
                  <p className="field-hint">A gente lembra da resposta.</p>
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
                      <p className="field-hint">Entra na fatura. Sai da conta quando você pagar a fatura.</p>
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
