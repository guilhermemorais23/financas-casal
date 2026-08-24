import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCurrentBudget } from "../budgets/budgets.service";
import { listDebts } from "../debts/debts.service";
import { listGoals } from "../goals/goals.service";
import { requireGroupId } from "../groups/groups.service";
import { getMonthlySummary, type CategorySummaryRow } from "../transactions/transactions.repository";
import { addMonths, currentMonthParam, parseMonthRange } from "../../utils/month";

export class InsightNotConfiguredError extends Error {}

export interface InsightContext {
  totalSpent: string;
  totalSpentPrevMonth: string;
  budgetCap: string | null;
  budgetSpent: number;
  debtsRemaining: number;
  goals: { name: string; targetAmount: string; currentAmount: string }[];
}

function formatCategories(rows: CategorySummaryRow[]): string {
  if (rows.length === 0) return "(nenhum gasto)";
  return rows
    .slice(0, 8)
    .map((row) => `${row.categoryName ?? "Sem categoria"}: R$ ${row.total}`)
    .join("\n");
}

function buildPrompt(
  month: string,
  current: { total: string; byCategory: CategorySummaryRow[] },
  previous: { total: string; byCategory: CategorySummaryRow[] },
  context: InsightContext
): string {
  const goalsText =
    context.goals.length === 0
      ? "Nenhuma meta cadastrada."
      : context.goals
          .map((g) => `${g.name}: guardado R$ ${g.currentAmount} de R$ ${g.targetAmount}`)
          .join("\n");

  const budgetText =
    context.budgetCap === null
      ? "Nenhum teto de orçamento definido para este mês."
      : `Teto do mês: R$ ${context.budgetCap}. Já gasto dentro desse teto: R$ ${context.budgetSpent.toFixed(2)}.`;

  return `Você é um assistente financeiro de um app de finanças para casais (PAR.), respondendo em português do Brasil, tom direto, prático e acolhedor, sem emojis.

Gastos de ${month} por categoria:
${formatCategories(current.byCategory)}
Total do mês: R$ ${current.total}

Gastos do mês anterior por categoria:
${formatCategories(previous.byCategory)}
Total do mês anterior: R$ ${previous.total}

Orçamento:
${budgetText}

Dívidas em aberto (soma de todas): R$ ${context.debtsRemaining.toFixed(2)}

Metas de economia:
${goalsText}

Escreva uma análise completa (3 parágrafos curtos, texto corrido, sem listas nem markdown):
1. Como foi o mês: maior categoria de gasto e a variação mais chamativa em relação ao mês anterior.
2. Como isso se encaixa no orçamento definido (se houver) e nas dívidas em aberto -- diga se dá pra acelerar o pagamento das dívidas ou se é melhor focar em reduzir gastos primeiro.
3. Progresso nas metas de economia (se houver) e pelo menos duas dicas práticas e específicas de onde cortar gasto, baseadas nas categorias com maior valor.

Não repita os números em formato de lista, escreva como texto corrido.`;
}

// Kept separate from the paused WhatsApp/audio assistant (which was going to
// use @anthropic-ai/sdk) -- this is a one-shot "analyze this month" call
// using the Gemini key the user already has.
export async function generateSpendingInsight(
  userId: string,
  monthParam?: string
): Promise<{ text: string; context: InsightContext }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new InsightNotConfiguredError();

  const groupId = await requireGroupId(userId);
  const effectiveMonth = monthParam ?? currentMonthParam();
  const { monthStart, monthEnd } = parseMonthRange(effectiveMonth);
  const prevRange = parseMonthRange(addMonths(effectiveMonth, -1));

  const [current, previous, budget, goals, debts] = await Promise.all([
    getMonthlySummary(groupId, userId, monthStart, monthEnd, "visible"),
    getMonthlySummary(groupId, userId, prevRange.monthStart, prevRange.monthEnd, "visible"),
    getCurrentBudget(userId, effectiveMonth),
    listGoals(userId),
    listDebts(userId),
  ]);

  const context: InsightContext = {
    totalSpent: current.total,
    totalSpentPrevMonth: previous.total,
    budgetCap: budget.budget?.capAmount ?? null,
    budgetSpent: budget.spent,
    debtsRemaining: debts.reduce((sum, debt) => sum + debt.remainingAmount, 0),
    goals: goals
      .filter((goal) => !goal.achievedAt)
      .map((goal) => ({ name: goal.name, targetAmount: goal.targetAmount, currentAmount: goal.currentAmount })),
  };

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(buildPrompt(effectiveMonth, current, previous, context));

  return { text: result.response.text().trim(), context };
}
