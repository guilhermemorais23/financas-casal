import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { currentMonthParam, formatCurrency } from "../utils/format";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";
import { parseMoney } from "../utils/money";

interface PayOffInstallment {
  installmentNumber: number;
  amount: string;
  isPaid: boolean;
}

// "Paguei tudo de uma vez" (com desconto, quitação antecipada): da parcela
// escolhida até a última, todas viram pagas no mês escolhido, dividindo o
// valor que saiu de verdade. As que já estavam marcadas como pagas nesse
// trecho têm o lançamento trocado -- o extrato fica com o que foi pago.
export function PayOffDebtSheet({
  debt,
  onClose,
  onSaved,
}: {
  debt: { id: string; name: string; installmentsCount: number; installments: PayOffInstallment[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const firstUnpaid = debt.installments.find((i) => !i.isPaid)?.installmentNumber ?? 1;
  const [fromInstallment, setFromInstallment] = useState(String(firstUnpaid));
  const [amount, setAmount] = useState("");
  const [referenceMonth, setReferenceMonth] = useState(currentMonthParam());
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const from = Number(fromInstallment);
  const covered = debt.installments.filter((i) => i.installmentNumber >= from);
  const fullValue = covered.reduce((sum, i) => sum + Number(i.amount), 0);
  const alreadyPaid = covered.filter((i) => i.isPaid).length;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = parseMoney(amount);
    if (!(parsedAmount > 0)) {
      setError("Informe quanto você pagou.");
      return;
    }
    setIsSaving(true);
    try {
      await apiRequest(`/debts/${debt.id}/payoff`, {
        method: "POST",
        token,
        body: { fromInstallment: from, amount: parsedAmount, referenceMonth },
      });
      showToast("Dívida quitada");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível quitar a dívida");
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="payoff-title">
      <h1 id="payoff-title">Paguei tudo de uma vez</h1>
      <p className="card-subtitle">{debt.name}</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="payoff-from">A partir da parcela</label>
          <select id="payoff-from" value={fromInstallment} onChange={(e) => setFromInstallment(e.target.value)}>
            {debt.installments.map((i) => (
              <option key={i.installmentNumber} value={i.installmentNumber}>
                {i.installmentNumber} de {debt.installmentsCount}
                {i.isPaid ? " (marcada como paga)" : ""}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {covered.length} parcela{covered.length === 1 ? "" : "s"}, {formatCurrency(fullValue)} sem desconto.
            {alreadyPaid > 0 &&
              ` ${alreadyPaid} já ${alreadyPaid === 1 ? "estava marcada" : "estavam marcadas"} como paga${alreadyPaid === 1 ? "" : "s"}: o lançamento delas é trocado pelo valor que você pagou.`}
          </p>
        </div>
        <div className="field">
          <label htmlFor="payoff-amount">Quanto você pagou de verdade (R$)</label>
          <input
            id="payoff-amount"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
            required
          />
        </div>
        <div className="field">
          <label htmlFor="payoff-month">Mês do pagamento</label>
          <input id="payoff-month" type="month" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)} required />
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
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Salvando..." : "Quitar"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
