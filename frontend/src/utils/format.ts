export function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "Hoje" (YYYY-MM-DD) no fuso do aparelho. `new Date().toISOString()` é UTC:
// no Brasil, depois das 21h já seria amanhã.
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

export function nextMonthParam(monthParam: string = currentMonthParam()): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(year, month, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// Aguenta um mês vazio ou mal formatado em vez de dar erro -- uma quebra de
// desenho aqui não tem error boundary pra pegar e deixa a página inteira em
// branco, então vira um texto reserva.
export function monthLongName(monthParam: string | null | undefined): string {
  if (!monthParam) return "—";
  const [year, month] = monthParam.split("-").map(Number);
  if (!year || !month) return "—";
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
}

// "2026-09" -> "setembro/2026"
export function monthYearLabel(monthParam: string | null | undefined): string {
  if (!monthParam) return "—";
  return `${monthLongName(monthParam)}/${monthParam.slice(0, 4)}`;
}

// "2026-08-20" -> uma Date à meia-noite local. `new Date("2026-08-20")` sozinho
// lê como meia-noite UTC, que vira o dia *anterior* quando formatada em
// qualquer fuso atrás do UTC (o Brasil inteiro) -- era por isso que as datas
// apareciam um dia antes do que foi digitado.
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

// "Hoje" / "Ontem" / "5 de agosto" -- supõe que quem chama passa uma data sem
// hora (YYYY-MM-DD), igual o `occurredAt` no resto do app.
export function dayLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr);
  const today = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return date.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

// Separa uma lista já ordenada por data em blocos do mesmo dia, pra uma tela
// de lista mostrar um cabeçalho "Hoje" / "Ontem" por dia, em vez de repetir a
// data em cada linha.
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
