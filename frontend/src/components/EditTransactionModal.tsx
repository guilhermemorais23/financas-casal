import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface CategoryRow {
  id: string;
  name: string;
  emoji: string | null;
}

export interface EditableTransaction {
  id: string;
  description: string;
  amount: string;
  transactionType: "expense" | "income";
  categoryId: string | null;
  occurredAt: string;
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
  const { token } = useAuth();
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  const [description, setDescription] = useState(transaction.description);
  const [amount, setAmount] = useState(transaction.amount);
  const [transactionType, setTransactionType] = useState<"expense" | "income">(
    transaction.transactionType
  );
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? "");
  const [occurredAt, setOccurredAt] = useState(transaction.occurredAt.slice(0, 10));

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    apiRequest<CategoryRow[]>("/categories", { token }).then(setCategories);
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
        },
      });
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
                  {category.emoji ? `${category.emoji} ` : ""}
                  {category.name}
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
