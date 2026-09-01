import { getGroupForUser } from "../groups/groups.service";
import { listDebts } from "../debts/debts.service";
import { getCategoryBudgets, getCurrentBudget } from "../budgets/budgets.service";
import { getDailySeriesForUser, getMonthlySummaryForUser, listTransactions } from "../transactions/transactions.service";
import { addMonths, parseMonthRange } from "../../utils/month";

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
  const prevMonth = addMonths(month, -1);

  const personalAccountId = groupResult.accounts.find(
    (account) => account.type === "personal" && account.ownerUserId === userId
  )?.id;

  const [recent, debts, summary, budget, categoryBudgets, dailyTrend, personalMonthTx, personalPrevMonthTx] =
    await Promise.all([
      listTransactions(userId, 8, month),
      listDebts(userId),
      getMonthlySummaryForUser(userId, month, "visible"),
      getCurrentBudget(userId, month),
      getCategoryBudgets(userId, month),
      getDailySeriesForUser(userId, month, "visible"),
      personalAccountId ? listTransactions(userId, 100, month, personalAccountId) : Promise.resolve([]),
      personalAccountId ? listTransactions(userId, 100, prevMonth, personalAccountId) : Promise.resolve([]),
    ]);

  return {
    group: { accounts: groupResult.accounts, members: groupResult.members },
    recent,
    debts,
    summary,
    budget,
    categoryBudgets,
    dailyTrend,
    personalMonthTx,
    personalPrevMonthTx,
  };
}
