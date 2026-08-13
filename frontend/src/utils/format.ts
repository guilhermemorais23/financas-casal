export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function currentMonthParam(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthParam(monthParam: string = currentMonthParam()): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLongName(monthParam: string): string {
  const [year, month] = monthParam.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
}

// "2026-09" -> "setembro/2026"
export function monthYearLabel(monthParam: string): string {
  return `${monthLongName(monthParam)}/${monthParam.slice(0, 4)}`;
}

// "2026-08-20" -> a Date at local midnight. `new Date("2026-08-20")` alone
// parses as UTC midnight, which then renders as the day *before* once
// formatted in any timezone behind UTC (all of Brazil) -- this is why dates
// were showing one day earlier than what was actually entered.
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// "Hoje" / "Ontem" / "5 de agosto" -- assumes callers pass a date-only string
// (YYYY-MM-DD), same as `occurredAt` everywhere else in this app.
export function dayLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

// Buckets an already date-sorted list into same-day runs, so a list view can
// show one "Hoje" / "Ontem" header per day instead of repeating the date on
// every row.
export function groupByDay<T extends { occurredAt: string }>(items: T[]): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.occurredAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
