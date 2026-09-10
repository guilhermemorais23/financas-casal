import { getAlertsForUser, type AlertItem } from "../alerts/alerts.service";
import { getGroupForUser } from "../groups/groups.service";
import { listDebts } from "../debts/debts.service";
import { getCategoryBudgets, getCurrentBudget } from "../budgets/budgets.service";
import { listGoals } from "../goals/goals.service";
import { listCards } from "../cards/cards.service";
import {
  getBalance,
  getDailySeriesForUser,
  getMonthlySummaryForUser,
  getMonthlyTrendForUser,
  listTransactions,
} from "../transactions/transactions.service";
import { parseMonthRange } from "../../utils/month";

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
}

// Nearest upcoming due date among statements that actually have something on
// them and aren't already paid -- an empty or already-settled statement
// isn't "coming up" in any way that belongs on the Painel.
function pickNextInvoice(cards: Awaited<ReturnType<typeof listCards>>): NextInvoice | null {
  const pending = cards
    .filter((card) => !card.currentStatement.isPaid && Number(card.currentStatement.total) > 0)
    .sort((a, b) => a.currentStatement.dueDate.localeCompare(b.currentStatement.dueDate));
  const next = pending[0];
  if (!next) return null;
  return { cardName: next.name, dueDate: next.currentStatement.dueDate, total: next.currentStatement.total };
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
  const isCurrentMonth = month === new Date().toISOString().slice(0, 7);

  const [recent, debts, summary, jointSummary, balance, budget, categoryBudgets, dailyTrend, goals, cards, trend6m, alerts] =
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
      isCurrentMonth ? getAlertsForUser(userId) : Promise.resolve<AlertItem[]>([]),
    ]);

  // trend6m's window always includes both of these (monthsBack defaults to
  // 6, never called with fewer than 2 here) -- last entry is `month` itself,
  // the one before it is the previous month.
  const currentMonthTotals = trend6m[trend6m.length - 1];
  const prevMonthTotals = trend6m[trend6m.length - 2];

  return {
    group: { accounts: groupResult.accounts, members: groupResult.members },
    recent,
    debts,
    summary,
    jointSummary,
    balance,
    budget,
    categoryBudgets,
    dailyTrend,
    personalMonthTotals: { income: currentMonthTotals.income, expense: currentMonthTotals.expense },
    personalPrevMonthTotals: { income: prevMonthTotals.income, expense: prevMonthTotals.expense },
    goalHighlight: pickGoalHighlight(goals),
    nextInvoice: pickNextInvoice(cards),
    trend6m,
    alerts,
  };
}
