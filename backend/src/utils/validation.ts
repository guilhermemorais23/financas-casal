// Checagens de entrada usadas por vários controllers.

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// Valor em reais: número de verdade (o JSON transforma 1e400 em Infinity),
// pelo menos 1 centavo e com um teto que nenhum lançamento real passa.
export const MAX_AMOUNT = 1_000_000_000;
export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.01 && value <= MAX_AMOUNT;
}

// "YYYY-MM-DD" que existe no calendário (nada de 2026-02-31).
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const MAX_DESCRIPTION_LENGTH = 200;
