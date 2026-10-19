export class InvalidMonthError extends Error {}

// "Hoje" no Brasil, "YYYY-MM-DD". Em UTC, depois das 21h já seria amanhã:
// um lançamento feito na noite do dia 31 caía no mês seguinte.
export function todayInBrazil(now: Date | number = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export function currentMonthParam(now: Date | number = new Date()): string {
  return todayInBrazil(now).slice(0, 7);
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

// "YYYY-MM" + N -> "YYYY-MM", N meses depois (N pode ser negativo).
export function addMonths(monthParam: string, count: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// "YYYY-MM" -> "YYYY-MM-01", a data usada pra lançar a parcela de uma dívida
// naquele mês, não importa o dia real em que foi paga.
export function monthToDate(monthParam: string): string {
  return `${monthParam}-01`;
}

// "YYYY-MM-DD" + N meses (N pode ser 0). Mantém o mesmo dia do mês quando
// dá; senão, usa o último dia do mês de destino (ex.: 31/jan + 1 mês ->
// 28 ou 29/fev), a mesma regra da maioria dos bancos e cartões nas cobranças
// recorrentes. Usado pra gerar as ocorrências futuras de um lançamento
// recorrente.
export function addMonthsToDate(dateParam: string, count: number): string {
  const [year, month, day] = dateParam.split("-").map(Number);
  // O dia 0 do mês *seguinte* == o último dia do próprio mês de destino, e é
  // isso que puxa um dia que passa do mês (dia 31 num mês de 30) pro último
  // dia, em vez de pular pro mês seguinte.
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month - 1 + count + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);
  const date = new Date(Date.UTC(year, month - 1 + count, clampedDay));
  return date.toISOString().slice(0, 10);
}

// "YYYY-MM" + um dia do mês -> "YYYY-MM-DD", limitado ao último dia daquele
// mês (mesma regra do addMonthsToDate acima). Usado pra transformar o dueDay
// de uma dívida ("vence todo dia 10") numa data de verdade pro
// referenceMonth de cada parcela.
export function dateForDayInMonth(monthParam: string, day: number): string {
  const [year, month] = monthParam.split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfMonth);
  return `${monthParam}-${String(clampedDay).padStart(2, "0")}`;
}

// Dias inteiros de uma "YYYY-MM-DD" até outra (positivo quando `toDate` é
// depois). Usado pelo job de lembretes pra saber quantos dias faltam pro
// vencimento da fatura de um cartão.
export function daysBetween(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}

export interface MonthRange {
  periodMonth: string;
  monthStart: string;
  monthEnd: string;
}

// monthParam é "YYYY-MM"; o padrão é o mês atual em UTC.
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
