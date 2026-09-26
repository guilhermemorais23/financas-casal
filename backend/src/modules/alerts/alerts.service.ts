import { getCurrentBudget } from "../budgets/budgets.service";
import { listCards } from "../cards/cards.service";
import { listDebts } from "../debts/debts.service";
import { getGroupForUser, requireGroupId } from "../groups/groups.service";
import { todayInBrazil } from "../loans/loans.service";
import { listRecurringBillsForUser } from "../recurringBills/recurringBills.service";
import { findTransactionsVisibleTo } from "../transactions/transactions.repository";
import { getMonthlySummaryForUser } from "../transactions/transactions.service";
import { addMonths, dateForDayInMonth, daysBetween } from "../../utils/month";

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

// Quantos dias antes do vencimento o aviso "vence antes do salário" aparece.
const SALARY_GAP_WINDOW_DAYS = 10;

function formatDayMonth(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${day}/${month}`;
}

function addDaysISO(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Próxima entrada que se repete (salário): uma conta fixa de receita ou uma
// ocorrência futura de uma receita recorrente. null = o app não sabe.
function nextSalaryDate(
  bills: Awaited<ReturnType<typeof listRecurringBillsForUser>>,
  future: Awaited<ReturnType<typeof findTransactionsVisibleTo>>,
  today: string
): string | null {
  const thisMonth = today.slice(0, 7);
  const dates: string[] = [];
  for (const bill of bills) {
    if (!bill.isActive || bill.transactionType !== "income") continue;
    let date = dateForDayInMonth(bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth, bill.dayOfMonth);
    if (date <= today) date = dateForDayInMonth(addMonths(thisMonth, 1), bill.dayOfMonth);
    dates.push(date);
  }
  for (const transaction of future) {
    if (transaction.transactionType === "income" && transaction.recurringGroupId) dates.push(transaction.occurredAt);
  }
  return dates.sort()[0] ?? null;
}

// Fatura que vence antes do salário cair, sem dinheiro nas contas pra pagar.
// No garantido, lembra que quem cobre é o dinheiro guardado.
async function salaryGapAlerts(
  userId: string,
  groupId: string,
  cards: Awaited<ReturnType<typeof listCards>>
): Promise<AlertItem[]> {
  const today = todayInBrazil();
  const due = cards.filter((card) => {
    const statement = card.currentStatement;
    if (statement.isPaid || Number(statement.total) <= 0) return false;
    const daysUntil = daysBetween(today, statement.dueDate);
    return daysUntil >= 0 && daysUntil <= SALARY_GAP_WINDOW_DAYS;
  });
  if (due.length === 0) return [];

  // Até 3 anos pra frente: uma série recorrente é criada inteira de uma vez.
  const [bills, future, group] = await Promise.all([
    listRecurringBillsForUser(userId),
    findTransactionsVisibleTo(groupId, userId, 2000, { monthStart: addDaysISO(today, 1), monthEnd: addDaysISO(today, 1100) }),
    getGroupForUser(userId),
  ]);
  const salary = nextSalaryDate(bills, future, today);
  if (!salary) return [];

  // O saldo das contas soma tudo que foi lançado, inclusive o que tem data
  // futura (os próximos salários de uma série). Aqui conta só o que já está lá hoje.
  const myAccounts = (group?.accounts ?? []).filter((account) => account.type === "joint" || account.ownerUserId === userId);
  const accountIds = new Set(myAccounts.map((account) => account.id));
  const futureNet = future
    .filter((transaction) => accountIds.has(transaction.accountId))
    .reduce((sum, transaction) => sum + (transaction.transactionType === "income" ? 1 : -1) * Number(transaction.amount), 0);
  const inAccounts = myAccounts.reduce((sum, account) => sum + account.balance, 0) - futureNet;

  return due
    .filter((card) => card.currentStatement.dueDate < salary && inAccounts < Number(card.currentStatement.total))
    .map((card) => ({
      id: `card-before-salary-${card.id}`,
      severity: "warning" as const,
      message:
        `Fatura do cartão "${card.name}" (${formatBRL(Number(card.currentStatement.total))}) vence ${formatDayMonth(card.currentStatement.dueDate)}, ` +
        `antes do salário (${formatDayMonth(salary)}). Nas contas hoje: ${formatBRL(inAccounts)}.` +
        (card.limitType === "secured" ? " Se não pagar, o banco usa o dinheiro guardado no cartão." : ""),
    }));
}

// includeDue: false no Painel, que já lista os vencimentos no próprio card
// "Vence logo" (upcoming.service.ts) -- não precisa dizer duas vezes.
export async function getAlertsForUser(userId: string, options: { includeDue?: boolean } = {}): Promise<AlertItem[]> {
  const includeDue = options.includeDue ?? true;
  // Not otherwise used here directly -- getCurrentBudget/listCards/listDebts/
  // getMonthlySummaryForUser each call requireGroupId themselves anyway, but
  // this one throws NoGroupError up front instead of waiting for whichever
  // of those five parallel calls happens to resolve first.
  const groupId = await requireGroupId(userId);

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

  // Vale também no Painel: o "Vence logo" mostra a data, mas não compara com o salário.
  alerts.push(...(await salaryGapAlerts(userId, groupId, cards)));

  const severityRank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
