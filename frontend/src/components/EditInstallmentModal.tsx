import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";

export interface EditableInstallment {
  debtId: string;
  id: string;
  installmentNumber: number;
  installmentsCount: number;
  amount: string;
  referenceMonth: string;
}

export function EditInstallmentModal({
  installment,
  onClose,
  onSaved,
}: {
  installment: EditableInstallment;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();

  const [referenceMonth, setReferenceMonth] = useState(installment.referenceMonth);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest(`/debts/${installment.debtId}/installments/${installment.id}`, {
        method: "PATCH",
        token,
        body: { referenceMonth },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar o mês");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUndo() {
    const confirmed = window.confirm(
      "Desfazer o pagamento dessa parcela? O lançamento gerado por ela some do extrato."
    );
    if (!confirmed) return;

    setIsUndoing(true);
    setError(null);
    try {
      await apiRequest(`/debts/${installment.debtId}/installments/${installment.id}`, {
        method: "PATCH",
        token,
        body: { isPaid: false },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível desfazer o pagamento");
      setIsUndoing(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1>Parcela {installment.installmentNumber}</h1>
        <p className="card-subtitle">
          {formatCurrency(Number(installment.amount))} de {installment.installmentsCount} · paga
        </p>

        <form onSubmit={handleSave}>
          <div className="field">
            <label htmlFor="installment-month">Contar no mês</label>
            <input
              id="installment-month"
              type="month"
              value={referenceMonth}
              onChange={(e) => setReferenceMonth(e.target.value)}
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
              {isSubmitting ? "Salvando..." : "Salvar mês"}
            </button>
          </div>
        </form>

        <button
          type="button"
          className="link-button danger-text"
          style={{ marginTop: "1rem" }}
          onClick={handleUndo}
          disabled={isUndoing}
        >
          {isUndoing ? "Desfazendo..." : "Desfazer pagamento dessa parcela"}
        </button>
      </div>
    </div>
  );
}
