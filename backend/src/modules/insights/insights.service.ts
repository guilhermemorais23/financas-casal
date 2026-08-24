import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireGroupId } from "../groups/groups.service";
import { getMonthlySummary, type CategorySummaryRow } from "../transactions/transactions.repository";
import { addMonths, currentMonthParam, parseMonthRange } from "../../utils/month";

export class InsightNotConfiguredError extends Error {}

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
  previous: { total: string; byCategory: CategorySummaryRow[] }
): string {
  return `Você é um assistente financeiro de um app de finanças para casais (PAR.), respondendo em português do Brasil, tom direto e amigável, sem emojis.

Gastos de ${month} por categoria:
${formatCategories(current.byCategory)}
Total do mês: R$ ${current.total}

Gastos do mês anterior por categoria:
${formatCategories(previous.byCategory)}
Total do mês anterior: R$ ${previous.total}

Escreva uma análise curta (no máximo 5 frases, texto corrido, sem lista) destacando a maior categoria de gasto, a variação mais chamativa em relação ao mês anterior, e uma sugestão prática de onde dá pra economizar. Não repita os números em formato de lista.`;
}

// Kept separate from the paused WhatsApp/audio assistant (which was going to
// use @anthropic-ai/sdk) -- this is just a one-shot "analyze this month's
// spending" call using the Gemini key the user already has.
export async function generateSpendingInsight(userId: string, monthParam?: string): Promise<{ text: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new InsightNotConfiguredError();

  const groupId = await requireGroupId(userId);
  const effectiveMonth = monthParam ?? currentMonthParam();
  const { monthStart, monthEnd } = parseMonthRange(effectiveMonth);
  const prevRange = parseMonthRange(addMonths(effectiveMonth, -1));

  const [current, previous] = await Promise.all([
    getMonthlySummary(groupId, userId, monthStart, monthEnd, "visible"),
    getMonthlySummary(groupId, userId, prevRange.monthStart, prevRange.monthEnd, "visible"),
  ]);

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(buildPrompt(effectiveMonth, current, previous));

  return { text: result.response.text().trim() };
}
