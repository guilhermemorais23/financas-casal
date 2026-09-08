import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export interface EditableRecurring {
  id: string;
  description: string;
  amount: string;
}

// "The rent went up" -- rewrites the amount on this occurrence and every
// future one in the same recurring series (backend: PATCH /:id/recurring).
// Already-happened occurrences are never touched, same scope as canceling a
// recurring series from a given point onward.
export function EditRecurringModal({
  transaction,
  onClose,
  onSaved,
}: {
  transaction: EditableRecurring;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [amount, setAmount] = useState(transaction.amount);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount.replace(",", "."));
    if (!(parsedAmount > 0)) {
      setError("Informe um valor válido.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/transactions/${transaction.id}/recurring`, {
        method: "PATCH",
        token,
        body: { amount: parsedAmount },
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
        <h1>Editar recorrência</h1>
        <p className="card-subtitle">
          Muda o valor de "{transaction.description}" a partir deste mês -- os meses que já passaram continuam com
          o valor antigo.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="edit-recurring-amount">Novo valor (R$)</label>
            <input
              id="edit-recurring-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              required
            />
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
              {isSubmitting ? "Salvando..." : "Salvar a partir daqui"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
