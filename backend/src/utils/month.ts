export class InvalidMonthError extends Error {}

export function currentMonthParam(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthParamFromDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

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

// "YYYY-MM-DD" + N months (N can be 0). Keeps the same day-of-month when
// possible; clamps to the target month's last day otherwise (e.g. Jan 31 + 1
// month -> Feb 28/29), same rule most banks/card issuers use for recurring
// charges. Used to generate a recurring transaction's future occurrences.
export function addMonthsToDate(dateParam: string, count: number): string {
  const [year, month, day] = dateParam.split("-").map(Number);
  // Day 0 of the *following* target month == the last day of the target
  // month itself, which is what clamps an overflowing day (day 31 in a
  // 30-day month) down automatically instead of rolling into the next one.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month - 1 + count + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const date = new Date(Date.UTC(year, month - 1 + count, clampedDay));
  return date.toISOString().slice(0, 10);
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
