import { todayInBrazil } from "../loans/loans.service";
import { getMonthlySummaryForUser, getMonthlyTrendForUser } from "../transactions/transactions.service";
import { addMonths } from "../../utils/month";

// Fechamento do mês: o resumo que a pessoa recebe no dia 1 (email) e vê no
// topo do Painel na primeira semana. Mesmas contas do Painel -- entrou menos
// saiu (menos o que foi guardado no cartão ou emprestado) -- pra os números
// nunca discordarem.
export interface MonthClose {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
  left: number;
  previousMonth: string;
  previousIncome: number;
  previousExpense: number;
  previousLeft: number;
  topCategories: { name: string; total: number }[];
  hasActivity: boolean;
}

export function previousMonthInBrazil(now = new Date()): string {
  return addMonths(todayInBrazil(now).slice(0, 7), -1);
}

export async function getMonthCloseForUser(userId: string, month = previousMonthInBrazil()): Promise<MonthClose> {
  const [trend, summary] = await Promise.all([
    getMonthlyTrendForUser(userId, month, 2),
    getMonthlySummaryForUser(userId, month, "own"),
  ]);
  const [previous, current] = trend;
  return {
    month,
    income: current.income,
    expense: current.expense,
    left: current.net,
    previousMonth: previous.month,
    previousIncome: previous.income,
    previousExpense: previous.expense,
    previousLeft: previous.net,
    topCategories: summary.byCategory.slice(0, 3).map((row) => ({
      name: row.categoryName ?? "Sem categoria",
      total: Number(row.total),
    })),
    hasActivity: current.income > 0 || current.expense > 0,
  };
}
