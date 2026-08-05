import { requireGroupId } from "../groups/groups.service";
import { parseMonthRange } from "../../utils/month";
import { findGroupBudget, getMonthlyExpenseTotal, upsertGroupBudget } from "./budgets.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidCapAmountError extends Error {}

export async function getCurrentBudget(userId: string, monthParam?: string) {
  const groupId = await requireGroupId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);

  const [budget, spent] = await Promise.all([
    findGroupBudget(groupId, periodMonth),
    getMonthlyExpenseTotal(groupId, monthStart, monthEnd),
  ]);

  return { periodMonth, budget, spent };
}

export async function setCurrentBudget(userId: string, capAmount: number, monthParam?: string) {
  if (capAmount <= 0) {
    throw new InvalidCapAmountError();
  }
  const groupId = await requireGroupId(userId);
  const { periodMonth } = parseMonthRange(monthParam);

  return upsertGroupBudget({ groupId, periodMonth, capAmount });
}
