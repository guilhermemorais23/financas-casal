import { requireCoupleId } from "../couples/couples.service";
import { parseMonthRange } from "../../utils/month";
import {
  findCoupleBudget,
  getMonthlyExpenseTotal,
  insertCoupleBudget,
  updateBudgetCap,
} from "./budgets.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidCapAmountError extends Error {}

export async function getCurrentBudget(userId: string, monthParam?: string) {
  const coupleId = await requireCoupleId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);

  const [budget, spent] = await Promise.all([
    findCoupleBudget(coupleId, periodMonth),
    getMonthlyExpenseTotal(coupleId, monthStart, monthEnd),
  ]);

  return { periodMonth, budget, spent };
}

export async function setCurrentBudget(userId: string, capAmount: number, monthParam?: string) {
  if (capAmount <= 0) {
    throw new InvalidCapAmountError();
  }
  const coupleId = await requireCoupleId(userId);
  const { periodMonth } = parseMonthRange(monthParam);

  const existing = await findCoupleBudget(coupleId, periodMonth);
  const budget = existing
    ? await updateBudgetCap(existing.id, capAmount)
    : await insertCoupleBudget({ coupleId, periodMonth, capAmount });

  return budget;
}
