import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useToast } from "./ToastProvider";

interface SplitStatusPillProps {
  token: string | null;
  transactionId: string;
  totalAmount: number;
  isSettled: boolean;
  // Chamado na hora (antes de o pedido terminar) pra etiqueta mudar já;
  // chamado de novo com o valor anterior se o pedido falhar, pra desfazer.
  onOptimisticChange: (nextIsSettled: boolean) => void;
  // Sinal de "algo mudou no servidor", dispara e esquece -- a tela de cima
  // recarrega em segundo plano pra atualizar o que depende disto (o total de
  // "Divisões em aberto"), sem travar a etiqueta.
  onSettled: () => void;
  onError: (message: string) => void;
}

// Botão pago/em aberto de um gasto dividido, que se vira sozinho. "Em aberto"
// abre um formulário pequeno pra confirmar quanto foi devolvido de fato
// (preenchido com metade do total -- editável, porque na prática nem sempre
// é 50/50 exato) antes de lançar como receita de verdade no backend.
// "✓ Pago" reabre com um clique, sem formulário, porque desfazer nunca pede
// valor (a receita ligada só é apagada).
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
  const { showToast } = useToast();
  const [amount, setAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function startSettling(event: React.MouseEvent) {
    event.stopPropagation();
    // Metade do total como padrão simples -- a maioria das divisões aqui é entre
    // 2 pessoas, e dá pra editar em qualquer outro caso (devolução parcial,
    // divisão desigual na prática etc.).
    setAmount((totalAmount / 2).toFixed(2).replace(".", ","));
    setIsFormOpen(true);
  }

  async function handleReopen(event: React.MouseEvent) {
    event.stopPropagation();
    onOptimisticChange(false);
    try {
      await apiRequest(`/transactions/${transactionId}/settle`, { method: "PATCH", token, body: { isSettled: false } });
      showToast("Divisão reaberta", { variant: "info" });
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
      showToast("Marcado como pago");
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
