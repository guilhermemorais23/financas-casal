import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from "../utils/paymentMethod";
import { useToast } from "./ToastProvider";

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

  useEffect(() => {
    apiRequest<CategoryRow[]>("/categories", { token }).then(setCategories);
    apiRequest<{ accounts: AccountRow[]; members: MemberRow[] }>("/groups/me", { token }).then((res) => {
      setAccounts(res.accounts);
      setMembers(res.members);
    });
  }, [token]);

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

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
