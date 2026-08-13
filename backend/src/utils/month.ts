export class InvalidMonthError extends Error {}

export function isValidMonthParam(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}-01T00:00:00Z`).getTime())
  );
}

// "YYYY-MM" + N -> "YYYY-MM", N months later (N can be negative).
export function addMonths(monthParam: string, count: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// "YYYY-MM" -> "YYYY-MM-01", the date used to book a debt installment's
// transaction against that month regardless of the real day it was paid.
export function monthToDate(monthParam: string): string {
  return `${monthParam}-01`;
}

export interface MonthRange {
  periodMonth: string;
  monthStart: string;
  monthEnd: string;
}

// monthParam is "YYYY-MM"; defaults to the current UTC month.
export function parseMonthRange(monthParam?: string): MonthRange {
  const reference = monthParam ? new Date(`${monthParam}-01T00:00:00Z`) : new Date();
  if (Number.isNaN(reference.getTime())) {
    throw new InvalidMonthError();
  }
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const periodMonth = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  return { periodMonth, monthStart: periodMonth, monthEnd };
}
