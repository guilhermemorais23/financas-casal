// How a lançamento was actually paid -- separate from which PAR account it's
// booked on and from parcelamento (a compra no crédito à vista is still
// "credit"). Must match PAYMENT_METHODS in the backend.
export type PaymentMethod = "credit" | "debit" | "pix" | "cash";

// Na ordem dos botões: o mais comum primeiro.
export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "credit", label: "Crédito" },
  { value: "debit", label: "Débito" },
  { value: "cash", label: "Dinheiro" },
];

// A última forma usada já vem marcada no próximo lançamento (por pessoa,
// neste aparelho).
const LAST_KEY = (userId: string) => `par:last-payment:${userId}`;

export function readLastPaymentMethod(userId: string): PaymentMethod | null {
  try {
    const value = localStorage.getItem(LAST_KEY(userId));
    return PAYMENT_METHOD_OPTIONS.some((option) => option.value === value) ? (value as PaymentMethod) : null;
  } catch {
    return null;
  }
}

export function saveLastPaymentMethod(userId: string, method: PaymentMethod | null): void {
  try {
    if (method) localStorage.setItem(LAST_KEY(userId), method);
  } catch {
    // Sem armazenamento: só não lembra.
  }
}

export function paymentMethodLabel(method: PaymentMethod | null): string | null {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? null;
}
