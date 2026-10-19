import { getCurrentBudget } from "../budgets/budgets.service";
import { listCards } from "../cards/cards.service";
import { listDebts } from "../debts/debts.service";
import { requireGroupId } from "../groups/groups.service";
import { getMonthlySummaryForUser } from "../transactions/transactions.service";
import { addMonths, daysBetween } from "../../utils/month";
import { formatBRL } from "../../utils/money";

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertItem {
  id: string;
  severity: AlertSeverity;
  message: string;
}

// Vencimento de cartão/dívida conta como "chegando" com a mesma antecedência
// que o job de lembrete por e-mail já usa (reminders.service.ts) -- um sinal
// só, mostrado em dois lugares, e não dois limites ajustados separadamente.
const DUE_WINDOW_DAYS = 3;

// Uma categoria precisa passar a própria média de 3 meses por mais que isto
// pra contar como "pico" que vale avisar, E passar este piso em reais -- uma
// categoria que foi de R$4 pra R$6 subiu 50%, mas não vale alerta; uma que
// foi de R$200 pra R$500 em Lazer vale.
const CATEGORY_SPIKE_RATIO = 0.3;
const CATEGORY_SPIKE_MIN_REAIS = 50;

function daysInMonth(monthParam: string): number {
  const [year, month] = monthParam.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dueLabel(daysUntil: number): string {
  if (daysUntil === 0) return "vence hoje";
  if (daysUntil > 0) return `vence em ${daysUntil} dia${daysUntil === 1 ? "" : "s"}`;
  return `venceu há ${-daysUntil} dia${-daysUntil === 1 ? "" : "s"}`;
}

// Projeção em linha reta: no ritmo que o grupo gastou até agora no mês, vai
// passar do teto do orçamento antes do mês acabar -- e, se sim, em quantos
// dias, mais ou menos. Só faz sentido no mês ATUAL (não há o que "projetar"
// num mês que já acabou).
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

// Compara o gasto deste mês em cada categoria com a média da mesma categoria
// nos 3 meses anteriores -- precisa de dados em pelo menos 2 desses 3 meses,
// pra que uma categoria que simplesmente não existia antes não vire "pico"
// no primeiro mês de uso.
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

// includeDue: false no Painel, que já lista os vencimentos no próprio card
// "Vence logo" (upcoming.service.ts) -- não precisa dizer duas vezes.
export async function getAlertsForUser(userId: string, options: { includeDue?: boolean } = {}): Promise<AlertItem[]> {
  const includeDue = options.includeDue ?? true;
  // Não é usado direto aqui -- getCurrentBudget/listCards/listDebts/
  // getMonthlySummaryForUser já chamam requireGroupId por conta própria, mas
  // este dispara o NoGroupError logo de cara, em vez de esperar qual das cinco
  // chamadas em paralelo terminar primeiro.
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

  for (const card of includeDue ? cards : []) {
    if (card.currentStatement.isPaid || Number(card.currentStatement.total) <= 0) continue;
    const daysUntil = daysBetween(todayISO, card.currentStatement.dueDate);
    if (daysUntil > DUE_WINDOW_DAYS) continue;
    alerts.push({
      id: `card-due-${card.id}`,
      severity: daysUntil < 0 ? "critical" : "warning",
      message: `Fatura do cartão "${card.name}" ${dueLabel(daysUntil)} (${formatBRL(Number(card.currentStatement.total))}).`,
    });
  }

  for (const debt of includeDue ? debts : []) {
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
