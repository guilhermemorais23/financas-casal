import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../utils/format";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "./ToastProvider";
import { Sheet } from "./Sheet";

export interface EditableInstallment {
  debtId: string;
  id: string;
  installmentNumber: number;
  installmentsCount: number;
  amount: string;
  referenceMonth: string;
}

// Parcela paga: muda o valor (pagou com desconto, com juros...) e o mês em
// que conta, ou desfaz o pagamento. O gasto no extrato acompanha.
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
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [referenceMonth, setReferenceMonth] = useState(installment.referenceMonth);
  const [amount, setAmount] = useState(Number(installment.amount).toFixed(2).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedAmount = Number(amount.includes(",") ? amount.replace(/\./g, "").replace(",", ".") : amount);
    if (!(parsedAmount > 0)) {
      setError("Informe um valor maior que zero.");
      return;
    }
    const body: { referenceMonth?: string; amount?: number } = {};
    if (referenceMonth !== installment.referenceMonth) body.referenceMonth = referenceMonth;
    if (Math.round(parsedAmount * 100) !== Math.round(Number(installment.amount) * 100)) body.amount = parsedAmount;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    try {
      await apiRequest(`/debts/${installment.debtId}/installments/${installment.id}`, {
        method: "PATCH",
        token,
        body,
      });
      showToast("Parcela atualizada");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a parcela");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUndo() {
    const confirmed = await confirm({
      title: "Desfazer o pagamento?",
      body: "O lançamento gerado por essa parcela some do extrato.",
      confirmLabel: "Desfazer pagamento",
    });
    if (!confirmed) return;

    setIsUndoing(true);
    setError(null);
    try {
      await apiRequest(`/debts/${installment.debtId}/installments/${installment.id}`, {
        method: "PATCH",
        token,
        body: { isPaid: false },
      });
      showToast("Pagamento desfeito");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível desfazer o pagamento");
      setIsUndoing(false);
    }
  }

  return (
    <Sheet onClose={onClose}>
      <h1>Parcela {installment.installmentNumber}</h1>
      <p className="card-subtitle">
        {formatCurrency(Number(installment.amount))} · {installment.installmentNumber} de {installment.installmentsCount} · paga
      </p>

      <form onSubmit={handleSave}>
        <div className="field">
          <label htmlFor="installment-amount">Valor pago (R$)</label>
          <input
            id="installment-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <p className="field-hint">O gasto no extrato e o total da dívida mudam junto.</p>
        </div>

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
            {isSubmitting ? "Salvando..." : "Salvar"}
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
    </Sheet>
  );
}
