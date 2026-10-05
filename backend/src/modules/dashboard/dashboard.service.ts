import { getAlertsForUser, type AlertItem } from "../alerts/alerts.service";
import { getGroupForUser } from "../groups/groups.service";
import { listDebts } from "../debts/debts.service";
import { getCategoryBudgets, getCurrentBudget } from "../budgets/budgets.service";
import { listGoals } from "../goals/goals.service";
import { listCards, owedOnCardsCents, savedInSecuredCardsCents } from "../cards/cards.service";
import {
  getBalance,
  getDailySeriesForUser,
  getMonthlySummaryForUser,
  getMonthlyTrendForUser,
  listTransactions,
} from "../transactions/transactions.service";
import { currentMonthParam, parseMonthRange } from "../../utils/month";
import { listLoans } from "../loans/loans.service";
import { getUpcomingForUser } from "../upcoming/upcoming.service";

export interface GoalHighlight {
  id: string;
  name: string;
  emoji: string | null;
  currentAmount: string;
  targetAmount: string;
}

// Closest to done among goals not yet achieved -- the one contributing to it
// next actually moves the needle, unlike showing the newest or a random one.
// photoDataUrl is deliberately dropped: it's a base64 image, and the
// dashboard payload already bundles 10+ other things in one response.
function pickGoalHighlight(goals: Awaited<ReturnType<typeof listGoals>>): GoalHighlight | null {
  const open = goals.filter((goal) => !goal.achievedAt);
  if (open.length === 0) return null;
  const best = open.reduce((closest, goal) => {
    const goalPercent = Number(goal.currentAmount) / Number(goal.targetAmount);
    const closestPercent = Number(closest.currentAmount) / Number(closest.targetAmount);
    return goalPercent > closestPercent ? goal : closest;
  });
  return {
    id: best.id,
    name: best.name,
    emoji: best.emoji,
    currentAmount: best.currentAmount,
    targetAmount: best.targetAmount,
  };
}

export interface NextInvoice {
  cardName: string;
  dueDate: string;
  total: string;
  limit: string | null;
  limitUsed: string | null;
  // open: tem fatura a pagar (a atual ou, se ela já foi paga, a próxima com
  // parcelas). paid / empty: nada a pagar agora -- o cartão continua no
  // Painel pra mostrar o limite.
  status: "open" | "paid" | "empty";
}

// A fatura a pagar mais próxima entre todos os cartões. Sem nenhuma em
// aberto, o cartão continua aparecendo (com o limite): antes o widget sumia
// do Painel logo depois de pagar a fatura ou quando o ciclo virava sem
// compras.
export function pickNextInvoice(cards: Awaited<ReturnType<typeof listCards>>): NextInvoice | null {
  if (cards.length === 0) return null;
  const options = cards.map((card) => {
    const statement = card.currentStatement;
    const base = { cardName: card.name, limit: card.limit, limitUsed: card.limitUsed };
    if (!statement.isPaid && Number(statement.total) > 0) {
      return { ...base, dueDate: statement.dueDate, total: statement.total, status: "open" as const };
    }
    // Atual paga (ou vazia), mas com parcelas de outro mês em aberto.
    const nextRelease = [...card.limitReleases]
      .filter((release) => release.month !== statement.month && Number(release.amount) > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (nextRelease) {
      return { ...base, dueDate: nextRelease.dueDate, total: nextRelease.amount, status: "open" as const };
    }
    return { ...base, dueDate: statement.dueDate, total: "0.00", status: statement.isPaid ? ("paid" as const) : ("empty" as const) };
  });
  const open = options.filter((option) => option.status === "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // Nada em aberto: o cartão com limite (é o que mais interessa ver), senão o primeiro.
  return open[0] ?? options.find((option) => option.limit !== null) ?? options[0];
}

export { InvalidMonthError } from "../../utils/month";

// Everything DashboardPage needs, in one call. The frontend used to fire 7
// separate requests for this (one per card/widget) -- each paid its own
// round trip AND its own Firebase ID token verification, which is real cost
// even though the underlying Firestore reads were already running in
// parallel on the client side. Bundling them server-side turns "N round
// trips to the same place" into 1, while the actual reads below still run
// concurrently via Promise.all, same as before.
export async function getDashboardForUser(userId: string, monthParam?: string) {
  const groupResult = await getGroupForUser(userId);
  if (!groupResult) return null;

  // parseMonthRange both validates monthParam and supplies the default
  // (today's month) exactly like every other endpoint that takes ?month= --
  // periodMonth is "YYYY-MM-01", trimmed here to the "YYYY-MM" every
  // sibling service function (and addMonths) actually expects.
  const { periodMonth } = parseMonthRange(monthParam);
  const month = periodMonth.slice(0, 7);
  // Alerts (budget pace, category spikes, upcoming due dates) are always
  // about *today*, not whatever month the Painel happens to be showing --
  // computing them while browsing March makes no sense, so they're only
  // fetched at all when `month` is the real current month.
  const isCurrentMonth = month === currentMonthParam();

  const [recent, debts, summary, jointSummary, balance, budget, categoryBudgets, dailyTrend, goals, cards, trend6m, alerts, loans, upcoming] =
    await Promise.all([
      listTransactions(userId, 8, month),
      listDebts(userId),
      getMonthlySummaryForUser(userId, month, "visible"),
      // "joint": only what left "Nossa Conta" this month, by who paid --
      // powers the compact "Par" card on the Painel (the visible-scope
      // `summary` above mixes in the requester's own personal spending too,
      // which isn't what "quanto cada um pôs na conta conjunta" means).
      getMonthlySummaryForUser(userId, month, "joint"),
      // Lifetime running "quem deve quem" from every equal-split expense
      // ever made (not scoped to this month -- there's no settle-up action
      // yet, so it accumulates like a running tab until someone pays back
      // outside the app and it's manually reconciled). Existed in the
      // backend for a while with no UI surfacing it at all.
      getBalance(userId),
      getCurrentBudget(userId, month),
      getCategoryBudgets(userId, month),
      getDailySeriesForUser(userId, month, "visible"),
      listGoals(userId),
      listCards(userId),
      // 6 months ending at `month` -- also this month's and last month's
      // personal income/expense totals (see getMonthlyTrendForUser), so the
      // hero card below no longer needs its own two 100-row fetches just to
      // sum two numbers each.
      getMonthlyTrendForUser(userId, month),
      isCurrentMonth ? getAlertsForUser(userId, { includeDue: false }) : Promise.resolve<AlertItem[]>([]),
      listLoans(userId),
      getUpcomingForUser(userId),
    ]);

  // trend6m's window always includes both of these (monthsBack defaults to
  // 6, never called with fewer than 2 here) -- last entry is `month` itself,
  // the one before it is the previous month.
  const currentMonthTotals = trend6m[trend6m.length - 1];
  const prevMonthTotals = trend6m[trend6m.length - 2];

  // Money parked in cartões com limite garantido -- left the accounts
  // (guardar is a transfer) but is still the person's, so "Seu dinheiro"
  // on the Painel adds it back.
  const savedInSecuredCards = savedInSecuredCardsCents(cards);

  return {
    group: { accounts: groupResult.accounts, members: groupResult.members },
    savedInSecuredCards: savedInSecuredCards / 100,
    // Faturas e parcelas de cartão ainda em aberto -- o Painel tira isso (e
    // as dívidas) pra mostrar "depois de pagar o que deve".
    owedOnCards: owedOnCardsCents(cards) / 100,
    // Empréstimos: o que ainda vai voltar -- "Seu dinheiro" mostra isso como
    // "quando receber tudo" em cima do que está nas contas.
    loansSummary: loans.summary,
    // "Eu devo": o que você pegou emprestado e ainda vai devolver.
    owedSummary: loans.owedSummary,
    // "Vence logo": pagar e receber nos próximos 7 dias (e atrasados).
    upcoming,
    recent,
    debts,
    summary,
    jointSummary,
    balance,
    budget,
    categoryBudgets,
    dailyTrend,
    personalMonthTotals: {
      income: currentMonthTotals.income,
      expense: currentMonthTotals.expense,
      savedInCards: currentMonthTotals.savedInCards,
    },
    personalPrevMonthTotals: { income: prevMonthTotals.income, expense: prevMonthTotals.expense },
    goalHighlight: pickGoalHighlight(goals),
    nextInvoice: pickNextInvoice(cards),
    trend6m,
    alerts,
  };
}
