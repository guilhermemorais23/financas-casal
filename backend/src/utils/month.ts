export class InvalidMonthError extends Error {}

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
