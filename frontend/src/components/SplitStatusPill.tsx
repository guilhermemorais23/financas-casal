import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";

interface SplitStatusPillProps {
  token: string | null;
  transactionId: string;
  totalAmount: number;
  isSettled: boolean;
  // Called immediately (before the request resolves) so the pill flips
  // right away; called again with the previous value if the request fails,
  // to revert it.
  onOptimisticChange: (nextIsSettled: boolean) => void;
  // Fire-and-forget signal that something changed server-side -- the parent
  // reloads in the background to catch up anything derived from this (the
  // "Divisões em aberto" total), without blocking the pill itself.
  onSettled: () => void;
  onError: (message: string) => void;
}

// Self-contained pago/aberto toggle for a split expense. "Em aberto" opens
// a tiny inline form to confirm the amount actually paid back (prefilled
// with half the total -- editable, since it's not always an exact 50/50 in
// practice) before booking it as a real income transaction on the backend.
// "✓ Pago" reopens in one click, no form needed, since undoing never asks
// for an amount (the linked income transaction is just deleted).
export function SplitStatusPill({
  token,
  transactionId,
  totalAmount,
  isSettled,
  onOptimisticChange,
  onSettled,
  onError,
}: SplitStatusPillProps) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function startSettling(event: React.MouseEvent) {
    event.stopPropagation();
    // A simple half-of-total default -- most splits here are between 2
    // people, and it's editable anyway for anything else (a partial
    // payback, an uneven split in practice, etc).
    setAmount((totalAmount / 2).toFixed(2).replace(".", ","));
    setIsFormOpen(true);
  }

  async function handleReopen(event: React.MouseEvent) {
    event.stopPropagation();
    onOptimisticChange(false);
    try {
      await apiRequest(`/transactions/${transactionId}/settle`, { method: "PATCH", token, body: { isSettled: false } });
      onSettled();
    } catch (err) {
      onOptimisticChange(true);
      onError(err instanceof ApiError ? err.message : "Não foi possível reabrir a divisão");
    }
  }

  async function handleConfirmSettle(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const parsedAmount = Number(amount.replace(",", "."));
    if (!(parsedAmount > 0)) return;

    setIsSubmitting(true);
    onOptimisticChange(true);
    try {
      await apiRequest(`/transactions/${transactionId}/settle`, {
        method: "PATCH",
        token,
        body: { isSettled: true, amount: parsedAmount },
      });
      setIsFormOpen(false);
      onSettled();
    } catch (err) {
      onOptimisticChange(false);
      onError(err instanceof ApiError ? err.message : "Não foi possível marcar como pago");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isFormOpen) {
    return (
      <form
        className="split-settle-form"
        onSubmit={handleConfirmSettle}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="split-settle-prefix">R$</span>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-icon" disabled={isSubmitting} title="Confirmar">
          ✓
        </button>
        <button
          type="button"
          className="btn-icon"
          onClick={(event) => {
            event.stopPropagation();
            setIsFormOpen(false);
          }}
          title="Cancelar"
        >
          ×
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      className={`split-status-pill${isSettled ? " settled" : ""}`}
      onClick={isSettled ? handleReopen : startSettling}
      title={isSettled ? "Reabrir divisão" : "Marcar como pago"}
    >
      {isSettled ? "✓ Pago" : "Em aberto"}
    </button>
  );
}
