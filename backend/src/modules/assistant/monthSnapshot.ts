import { getGroupForUser } from "../groups/groups.service";
import { listLoans, todayInBrazil } from "../loans/loans.service";
import { getMonthlyTrendForUser } from "../transactions/transactions.service";
import { getUpcomingForUser, type UpcomingItem } from "../upcoming/upcoming.service";

// Os números que uma conversa de "controle do mês" sempre volta a usar, num
// lugar só: o que tem nas contas, o que entrou e saiu no mês, quanto sobra
// por dia, o que vence na semana e quem te deve. Alimenta o prompt da IA E as
// respostas sem IA, pra que as duas digam a mesma coisa.
export interface MonthSnapshot {
  balanceToday: number;
  income: number;
  expense: number;
  monthLeft: number;
  daysLeft: number;
  dailyAllowance: number;
  upcoming: UpcomingItem[];
  loansOutstanding: number;
  loansOverdue: number;
  loans: { personName: string; remaining: number; dueDate: string | null; isOverdue: boolean }[];
}

export function brl(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function buildMonthSnapshot(userId: string): Promise<MonthSnapshot> {
  const today = todayInBrazil();
  const month = today.slice(0, 7);
  const [group, trend, upcoming, loans] = await Promise.all([
    getGroupForUser(userId),
    getMonthlyTrendForUser(userId, month, 1),
    getUpcomingForUser(userId),
    listLoans(userId),
  ]);
  const current = trend[trend.length - 1];
  const income = current?.income ?? 0;
  const expense = current?.expense ?? 0;
  const monthLeft = current?.net ?? 0;
  const [year, monthNumber, day] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const daysLeft = daysInMonth - day + 1;
  return {
    balanceToday: (group?.accounts ?? []).reduce((sum, account) => sum + account.balance, 0),
    income,
    expense,
    monthLeft,
    daysLeft,
    dailyAllowance: monthLeft / daysLeft,
    upcoming,
    loansOutstanding: Number(loans.summary.outstanding),
    loansOverdue: Number(loans.summary.overdue),
    loans: loans.loans
      .filter((loan) => loan.status === "open" && Number(loan.remaining) > 0)
      .map((loan) => ({
        personName: loan.personName,
        remaining: Number(loan.remaining),
        dueDate: loan.dueDate,
        isOverdue: loan.isOverdue,
      })),
  };
}

function whenLabel(daysUntil: number): string {
  if (daysUntil < 0) return `atrasado ${-daysUntil}d`;
  if (daysUntil === 0) return "hoje";
  if (daysUntil === 1) return "amanhã";
  return `em ${daysUntil} dias`;
}

export function snapshotAsText(s: MonthSnapshot): string {
  const upcomingText = s.upcoming.length
    ? s.upcoming
        .map((item) => `${item.direction === "pay" ? "pagar" : "receber"} ${item.title} ${brl(item.amount)} (${whenLabel(item.daysUntil)})`)
        .join("; ")
    : "nada vencendo nos próximos 7 dias";
  const loansText = s.loans.length
    ? s.loans.map((loan) => `${loan.personName} deve ${brl(loan.remaining)}${loan.dueDate ? `, prazo ${loan.dueDate}` : ", sem prazo"}${loan.isOverdue ? " (atrasado)" : ""}`).join("; ")
    : "ninguém deve nada";
  return `Saldo nas contas hoje: ${brl(s.balanceToday)}.
Este mês (conta pessoal): entrou ${brl(s.income)}, saiu ${brl(s.expense)}, sobra ${brl(s.monthLeft)}.
Faltam ${s.daysLeft} dias pro mês acabar: dá pra gastar ${brl(Math.max(0, s.dailyAllowance))} por dia.
Vence nos próximos 7 dias: ${upcomingText}.
Empréstimos a receber: ${loansText}. Total a receber: ${brl(s.loansOutstanding)}; quando receber tudo, fica com ${brl(s.balanceToday + s.loansOutstanding)}.`;
}

// Respostas em linguagem simples direto dos números -- usadas quando a IA não
// está configurada ou falha, pro assistente continuar ajudando com o mês.
export function answerFromSnapshot(s: MonthSnapshot, question: string): string {
  const q = question.toLowerCase();
  const lines: string[] = [];
  const wantsDue = /venc|pagar|conta|fatura|parcela|semana/.test(q);
  const wantsLoans = /dev[eo]|receb|empr[eé]st|me paga/.test(q);
  const wantsDaily = /por dia|posso gastar|quanto (d[aá]|posso)|sobra/.test(q);

  if (wantsDaily || (!wantsDue && !wantsLoans)) {
    lines.push(
      s.monthLeft >= 0
        ? `Este mês entrou ${brl(s.income)} e saiu ${brl(s.expense)}. Sobram ${brl(s.monthLeft)}, dá ${brl(s.dailyAllowance)} por dia pelos próximos ${s.daysLeft} dias.`
        : `Este mês saiu ${brl(s.expense)} e entrou ${brl(s.income)}: você está ${brl(-s.monthLeft)} no vermelho. Vale segurar os gastos até o mês virar.`
    );
  }
  if (wantsDue || (!wantsDaily && !wantsLoans)) {
    const toPay = s.upcoming.filter((item) => item.direction === "pay");
    lines.push(
      toPay.length
        ? `Vence logo: ${toPay.map((item) => `${item.title} ${brl(item.amount)} (${whenLabel(item.daysUntil)})`).join(", ")}.`
        : "Nada pra pagar nos próximos 7 dias."
    );
  }
  if (wantsLoans || (!wantsDue && !wantsDaily && s.loans.length > 0)) {
    lines.push(
      s.loans.length
        ? `Te devem ${brl(s.loansOutstanding)}${s.loansOverdue > 0 ? ` (${brl(s.loansOverdue)} atrasado)` : ""}. Quando receber tudo, você fica com ${brl(s.balanceToday + s.loansOutstanding)}.`
        : "Ninguém te deve nada agora."
    );
  }
  return lines.join("\n");
}

// "gastei 50 no mercado" / "paguei R$ 120,90 de luz" / "recebi 200" -- os
// poucos formatos que valem a pena pegar sem IA.
export function parseQuickEntry(text: string): { type: "expense" | "income"; amount: number; description: string } | null {
  const match = text
    .trim()
    .match(/^(gastei|paguei|comprei|recebi|ganhei)\s+(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:reais)?\s*(?:(?:no|na|de|do|da|em|com|pro|pra)\s+)?(.*)$/i);
  if (!match) return null;
  const raw = match[2];
  const amount = Number(raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw);
  if (!(amount > 0)) return null;
  const verb = match[1].toLowerCase();
  const rest = match[3].trim();
  return {
    type: verb === "recebi" || verb === "ganhei" ? "income" : "expense",
    amount,
    description: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : verb === "recebi" || verb === "ganhei" ? "Entrada" : "Gasto",
  };
}
