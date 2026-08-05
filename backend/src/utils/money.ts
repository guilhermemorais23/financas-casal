// All money is stored in Firestore as integer cents (avoids float-precision
// bugs -- Firestore numbers are JS doubles). The REST API contract to the
// frontend stays decimal strings like "200.00"; conversion happens only at
// the repository boundary.
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Splits totalAmount into `count` shares as evenly as possible in cents,
// with any leftover cent distributed to the earliest shares (so nothing is
// lost/gained to rounding). Used both for debt installments and for
// equal-split transaction shares across however many group members there are.
export function splitEvenly(totalAmount: number, count: number): number[] {
  const totalCents = toCents(totalAmount);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}
