import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { readCreditCardPreference } from "../utils/creditCardPreference";
import { formatCurrency } from "../utils/format";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "../utils/paymentMethod";
import { useToast } from "./ToastProvider";
import { Sheet } from "./Sheet";

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

interface AccountRow {
  id: string;
  type: "personal" | "joint";
  name: string;
  emoji: string | null;
}

interface CardOption {
  id: string;
  name: string;
}

// Mesmas opções de parcelas que a tela de Cartões aceita.
const INSTALLMENT_OPTIONS = [1, 2, 3, 4, 6, 12];

type Mode = "edit" | "split" | "card";

interface SplitPart {
  amount: string;
  categoryId: string;
}

const toCents = (value: string) => Math.round(Number(value.replace(",", ".")) * 100);

interface MemberRow {
  id: string;
  displayName: string;
}

export interface EditableTransaction {
  id: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  categoryId: string | null;
  occurredAt: string;
  accountId: string;
  payerId: string;
  paymentMethod: PaymentMethod | null;
}

export function EditTransactionModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: EditableTransaction;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);

  const [description, setDescription] = useState(transaction.description);
  const [amount, setAmount] = useState(transaction.amount);
  const [transactionType, setTransactionType] = useState<"expense" | "income">(
    transaction.transactionType
  );
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(transaction.occurredAt.slice(0, 10));
  const [accountId, setAccountId] = useState(transaction.accountId);
  const [payerId, setPayerId] = useState(transaction.payerId);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">(transaction.paymentMethod ?? "");

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // "Dividir por categoria" e "Mover pro cartão" usam o mesmo painel.
  const [mode, setMode] = useState<Mode>("edit");
  const [parts, setParts] = useState<SplitPart[]>(() => [
    { amount: Number(transaction.amount).toFixed(2).replace(".", ","), categoryId: transaction.categoryId ?? "" },
    { amount: "", categoryId: "" },
  ]);
  const [cards, setCards] = useState<CardOption[]>([]);
  const [cardId, setCardId] = useState("");
  const [installments, setInstallments] = useState("1");

  const totalCents = toCents(transaction.amount);
  const partsCents = parts.reduce((sum, part) => sum + (toCents(part.amount) || 0), 0);
  const remainingCents = totalCents - partsCents;

  useEffect(() => {
    apiRequest<CategoryRow[]>("/categories", { token }).then(setCategories);
    apiRequest<CardOption[]>("/cards", { token })
      .then(async (result) => {
        setCards(result);
        const preferred = await readCreditCardPreference(token, user?.id ?? "");
        setCardId(result.find((card) => card.id === preferred)?.id ?? result[0]?.id ?? "");
      })
      .catch(() => setCards([]));
    apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }).then((res) => {
      setAccounts(res.accounts);
      setMembers(res.members);
    });
  }, [token, user?.id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount.toString().replace(",", "."));
    if (!description.trim() || !occurredAt || !(parsedAmount > 0)) {
      setError("Preencha descrição, valor e data.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/transactions/${transaction.id}`, {
        method: "PATCH",
        token,
        body: {
          description: description.trim(),
          amount: parsedAmount,
          transactionType,
          categoryId: categoryId || null,
          occurredAt,
          accountId,
          payerId,
          paymentMethod: paymentMethod || null,
        },
      });
      showToast("Lançamento atualizado");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar as alterações");
    } finally {
      setIsSubmitting(false);
    }
  }

  // Ajusta a primeira parte pra fechar a conta quando a pessoa mexe nas outras.
  function updatePart(index: number, patch: Partial<SplitPart>) {
    setParts((current) => {
      const next = current.map((part, i) => (i === index ? { ...part, ...patch } : part));
      if (index !== 0 && patch.amount !== undefined) {
        const others = next.slice(1).reduce((sum, part) => sum + (toCents(part.amount) || 0), 0);
        const first = Math.max(0, totalCents - others);
        next[0] = { ...next[0], amount: (first / 100).toFixed(2).replace(".", ",") };
      }
      return next;
    });
  }

  async function handleSplit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (parts.some((part) => !(toCents(part.amount) > 0))) {
      setError("Cada parte precisa ter um valor maior que zero.");
      return;
    }
    if (remainingCents !== 0) {
      setError(`As partes precisam somar ${formatCurrency(totalCents / 100)}.`);
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest(`/transactions/${transaction.id}/split-category`, {
        method: "POST",
        token,
        body: { parts: parts.map((part) => ({ amount: toCents(part.amount) / 100, categoryId: part.categoryId || null })) },
      });
      showToast(`Dividido em ${parts.length} categorias`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível dividir");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleMoveToCard(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!cardId) return;
    setIsSubmitting(true);
    try {
      await apiRequest(`/cards/${cardId}/purchases/from-transaction`, {
        method: "POST",
        token,
        body: { transactionId: transaction.id, installments: Number(installments) },
      });
      showToast(`Movido pro cartão ${cards.find((card) => card.id === cardId)?.name ?? ""}`, {
        description: "Sai da conta quando você pagar a fatura",
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409 && err.message === "statement already paid"
          ? "A fatura desse mês já foi paga. Reabra a fatura em Cartões pra mover."
          : err instanceof ApiError
            ? err.message
            : "Não foi possível mover pro cartão"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const canMoveToCard = transaction.transactionType === "expense" && cards.length > 0;

  if (mode === "split") {
    return (
      <Sheet onClose={onClose}>
        <h1>Dividir por categoria</h1>
        <p className="card-subtitle">
          {transaction.description} · {formatCurrency(totalCents / 100)}. Ex.: no mercado, R$ 150 de Alimentação e R$ 50 de Casa.
        </p>
        <form onSubmit={handleSplit}>
          <ul className="split-parts">
            {parts.map((part, index) => (
              <li key={index}>
                <input
                  id={`split-amount-${index}`}
                  inputMode="decimal"
                  placeholder="0,00"
                  value={part.amount}
                  onChange={(e) => updatePart(index, { amount: e.target.value })}
                  aria-label={`Valor da parte ${index + 1}`}
                />
                <select
                  id={`split-category-${index}`}
                  value={part.categoryId}
                  onChange={(e) => updatePart(index, { categoryId: e.target.value })}
                  aria-label={`Categoria da parte ${index + 1}`}
                >
                  <option value="">Sem categoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {index > 1 && (
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Tirar parte ${index + 1}`}
                    onClick={() => setParts((current) => current.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="split-parts-footer">
            {parts.length < 10 && (
              <button type="button" className="link-button" onClick={() => setParts((current) => [...current, { amount: "", categoryId: "" }])}>
                + Outra categoria
              </button>
            )}
            <span className={remainingCents === 0 ? "" : "danger-text"}>
              {remainingCents === 0
                ? "Fecha certinho"
                : remainingCents > 0
                  ? `Falta ${formatCurrency(remainingCents / 100)}`
                  : `Passou ${formatCurrency(-remainingCents / 100)}`}
            </span>
          </div>
          <p className="field-hint">Cada parte vira um lançamento com a mesma data, conta e descrição.</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setMode("edit")}>
              Voltar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Dividindo..." : "Dividir"}
            </button>
          </div>
        </form>
      </Sheet>
    );
  }

  if (mode === "card") {
    return (
      <Sheet onClose={onClose}>
        <h1>Mover pro cartão</h1>
        <p className="card-subtitle">
          {transaction.description} · {formatCurrency(totalCents / 100)}. Deixa de descontar da conta agora e entra na fatura do
          cartão. Só sai da conta quando você pagar a fatura.
        </p>
        <form onSubmit={handleMoveToCard}>
          <div className="field">
            <label htmlFor="move-card">Cartão</label>
            <select id="move-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
              {cards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="move-installments">Parcelas</label>
            <select id="move-installments" value={installments} onChange={(e) => setInstallments(e.target.value)}>
              {INSTALLMENT_OPTIONS.map((count) => (
                <option key={count} value={count}>
                  {count === 1 ? "À vista" : `${count}x`}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setMode("edit")}>
              Voltar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !cardId}>
              {isSubmitting ? "Movendo..." : "Mover pro cartão"}
            </button>
          </div>
        </form>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <h1>Editar lançamento</h1>

      <div className="segmented">
        <button
          type="button"
          className={`segmented-option${transactionType === "expense" ? " active" : ""}`}
          onClick={() => setTransactionType("expense")}
        >
          Despesa
        </button>
        <button
          type="button"
          className={`segmented-option${transactionType === "income" ? " active" : ""}`}
          onClick={() => setTransactionType("income")}
        >
          Receita
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="edit-description">Descrição</label>
          <input
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-amount">Valor (R$)</label>
            <input
              id="edit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="edit-date">Data</label>
            <input
              id="edit-date"
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="edit-category">Categoria</label>
          <select id="edit-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="edit-account">Conta</label>
            <select id="edit-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="edit-payer">{transactionType === "income" ? "Quem recebeu" : "Quem pagou"}</label>
            <select id="edit-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.id === user?.id ? "Você" : member.displayName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="edit-payment-method">
            {transactionType === "income" ? "Forma de recebimento" : "Forma de pagamento"}
          </label>
          <select
            id="edit-payment-method"
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

        <div className="edit-extra-actions">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setError(null);
              setMode("split");
            }}
          >
            Dividir por categoria
          </button>
          {canMoveToCard && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setError(null);
                setMode("card");
              }}
            >
              Foi no cartão? Mover pro cartão
            </button>
          )}
        </div>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
