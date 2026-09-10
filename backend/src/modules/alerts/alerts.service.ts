import { getCurrentBudget } from "../budgets/budgets.service";
import { listCards } from "../cards/cards.service";
import { listDebts } from "../debts/debts.service";
import { requireGroupId } from "../groups/groups.service";
import { getMonthlySummaryForUser } from "../transactions/transactions.service";
import { addMonths, daysBetween } from "../../utils/month";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  message: string;
}

// A card/debt due date counts as "coming up" the same number of days out as
// the email reminder job already uses (reminders.service.ts) -- one signal,
// surfaced in two places, not two independently-tuned thresholds.
const DUE_WINDOW_DAYS = 3;

// A category needs to beat its own 3-month average by more than this to
// count as a "spike" worth mentioning, AND clear this absolute floor -- a
// category that went from R$4 to R$6 is technically +50% but not worth an
// alert; one that went from R$200 to R$500 in Lazer is.
const CATEGORY_SPIKE_RATIO = 0.3;
const CATEGORY_SPIKE_MIN_REAIS = 50;

function formatBRL(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function daysInMonth(monthParam: string): number {
  const [year, month] = monthParam.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dueLabel(daysUntil: number): string {
  if (daysUntil === 0) return "vence hoje";
  if (daysUntil > 0) return `vence em ${daysUntil} dia${daysUntil === 1 ? "" : "s"}`;
  return `venceu há ${-daysUntil} dia${-daysUntil === 1 ? "" : "s"}`;
}

// Linear pace projection: at the rate the group has spent so far this
// month, will it clear the budget cap before the month is over -- and if
// so, in roughly how many days from today. Only makes sense for the
// CURRENT month (there's nothing to "project" about a month already over).
function budgetPaceAlert(capAmount: number, spent: number, month: string, today: Date): AlertItem | null {
  const dayOfMonth = today.getUTCDate();
  if (capAmount <= 0 || dayOfMonth <= 0) return null;

  if (spent >= capAmount) {
    return {
      id: "budget-exceeded",
      severity: "critical",
      message: `O orçamento do mês já estourou: ${formatBRL(spent)} de ${formatBRL(capAmount)}.`,
    };
  }

  const dailyRate = spent / dayOfMonth;
  if (dailyRate <= 0) return null;

  const totalDays = daysInMonth(month);
  const projected = dailyRate * totalDays;
  if (projected <= capAmount) return null;

  const daysUntilExceeded = Math.max(1, Math.ceil((capAmount - spent) / dailyRate));
  if (dayOfMonth + daysUntilExceeded > totalDays) return null;

  return {
    id: "budget-pace",
    severity: "warning",
    message: `No ritmo atual, o orçamento do mês estoura em ~${daysUntilExceeded} dia${daysUntilExceeded === 1 ? "" : "s"} (projeção: ${formatBRL(projected)}).`,
  };
}

// Compares this month's spend in each category against the average of the
// same category over the previous 3 months -- needs at least 2 of those 3
// months to actually have data, so a category that simply didn't exist
// before never "spikes" on its first real month.
function categorySpikeAlerts(
  currentByCategory: { categoryId: string | null; categoryName: string | null; categoryEmoji: string | null; total: string }[],
  previousByCategory: { categoryId: string | null; categoryName: string | null; total: string }[][]
): AlertItem[] {
  const history = new Map<string, number[]>();
  for (const monthRows of previousByCategory) {
    for (const row of monthRows) {
      if (row.categoryId === null) continue;
      const list = history.get(row.categoryId) ?? [];
      list.push(Number(row.total));
      history.set(row.categoryId, list);
    }
  }

  const alerts: AlertItem[] = [];
  for (const row of currentByCategory) {
    if (row.categoryId === null) continue;
    const previousAmounts = history.get(row.categoryId) ?? [];
    if (previousAmounts.length < 2) continue;

    const average = previousAmounts.reduce((sum, value) => sum + value, 0) / previousAmounts.length;
    const current = Number(row.total);
    if (average <= 0 || current < CATEGORY_SPIKE_MIN_REAIS) continue;
    if (current <= average * (1 + CATEGORY_SPIKE_RATIO)) continue;

    const percent = Math.round(((current - average) / average) * 100);
    alerts.push({
      id: `category-spike-${row.categoryId}`,
      severity: "info",
      message: `${row.categoryEmoji ?? "📈"} ${row.categoryName ?? "Categoria"}: ${percent}% acima da média dos últimos meses (${formatBRL(current)} vs ~${formatBRL(average)}).`,
    });
  }
  return alerts;
}

export async function getAlertsForUser(userId: string): Promise<AlertItem[]> {
  // Not otherwise used here directly -- getCurrentBudget/listCards/listDebts/
  // getMonthlySummaryForUser each call requireGroupId themselves anyway, but
  // this one throws NoGroupError up front instead of waiting for whichever
  // of those five parallel calls happens to resolve first.
  await requireGroupId(userId);

  const today = new Date();
  const month = today.toISOString().slice(0, 7);
  const previousMonths = [1, 2, 3].map((count) => addMonths(month, -count));

  const [budgetInfo, cards, debts, currentSummary, previousSummaries] = await Promise.all([
    getCurrentBudget(userId, month),
    listCards(userId),
    listDebts(userId),
    getMonthlySummaryForUser(userId, month, "visible"),
    Promise.all(previousMonths.map((m) => getMonthlySummaryForUser(userId, m, "visible"))),
  ]);

  const alerts: AlertItem[] = [];

  if (budgetInfo.budget) {
    const paceAlert = budgetPaceAlert(Number(budgetInfo.budget.capAmount), budgetInfo.spent, month, today);
    if (paceAlert) alerts.push(paceAlert);
  }

  alerts.push(...categorySpikeAlerts(currentSummary.byCategory, previousSummaries.map((s) => s.byCategory)));

  const todayISO = today.toISOString().slice(0, 10);

  for (const card of cards) {
    if (card.currentStatement.isPaid || Number(card.currentStatement.total) <= 0) continue;
    const daysUntil = daysBetween(todayISO, card.currentStatement.dueDate);
    if (daysUntil > DUE_WINDOW_DAYS) continue;
    alerts.push({
      id: `card-due-${card.id}`,
      severity: daysUntil < 0 ? "critical" : "warning",
      message: `Fatura do cartão "${card.name}" ${dueLabel(daysUntil)} (${formatBRL(Number(card.currentStatement.total))}).`,
    });
  }

  for (const debt of debts) {
    const nextUnpaid = debt.installments.filter((i) => !i.isPaid).sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    if (!nextUnpaid?.dueDate) continue;
    const daysUntil = daysBetween(todayISO, nextUnpaid.dueDate);
    if (daysUntil > DUE_WINDOW_DAYS) continue;
    alerts.push({
      id: `debt-due-${debt.id}`,
      severity: daysUntil < 0 ? "critical" : "warning",
      message: `Parcela ${nextUnpaid.installmentNumber}/${debt.installmentsCount} de "${debt.name}" ${dueLabel(daysUntil)} (${formatBRL(Number(nextUnpaid.amount))}).`,
    });
  }

  const severityRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
