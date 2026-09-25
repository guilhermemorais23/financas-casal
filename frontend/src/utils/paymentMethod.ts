// How a lançamento was actually paid -- separate from which PAR account it's
// booked on and from parcelamento (a compra no crédito à vista is still
// "credit"). Must match PAYMENT_METHODS in the backend.
export type PaymentMethod = "credit" | "debit" | "pix" | "cash";

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "credit", label: "Crédito" },
  { value: "debit", label: "Débito" },
  { value: "pix", label: "Pix" },
  { value: "cash", label: "Dinheiro" },
];

export function paymentMethodLabel(method: PaymentMethod | null): string | null {
  return PAYMENT_METHOD_OPTIONS.find((option) => option.value === method)?.label ?? null;
}
