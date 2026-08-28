import { requireGroupId } from "../groups/groups.service";
import { parseMonthRange } from "../../utils/month";
import { categoryIsVisibleTo, findVisibleCategories } from "../categories/categories.repository";
import { getMonthlySummary } from "../transactions/transactions.repository";
import {
  deleteCategoryBudget,
  findCategoryBudgets,
  findGroupBudget,
  getMonthlyExpenseTotal,
  upsertCategoryBudget,
  upsertGroupBudget,
  type BudgetRow,
} from "./budgets.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidCapAmountError extends Error {}
export class InvalidCategoryError extends Error {}

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

export interface CategoryBudgetRow {
  categoryId: string;
  categoryName: string;
  categoryEmoji: string | null;
  capAmount: string | null;
  spent: number;
}

export async function getCategoryBudgets(userId: string, monthParam?: string): Promise<CategoryBudgetRow[]> {
  const groupId = await requireGroupId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);

  const categories = await findVisibleCategories(groupId);
  const categoryIds = categories.map((category) => category.id);

  const [budgetsByCategory, summary] = await Promise.all([
    findCategoryBudgets(groupId, periodMonth, categoryIds),
    // "visible" matches what the Painel's "Maiores gastos" card itself
    // requests -- the spent figure shown next to a category's cap here must
    // never disagree with the one already on screen there.
    getMonthlySummary(groupId, userId, monthStart, monthEnd, "visible"),
  ]);
  const spentByCategoryId = new Map(summary.byCategory.map((row) => [row.categoryId, Number(row.total)]));

  return categories.map((category) => ({
    categoryId: category.id,
    categoryName: category.name,
    categoryEmoji: category.emoji,
    capAmount: (budgetsByCategory.get(category.id) as BudgetRow | undefined)?.capAmount ?? null,
    spent: spentByCategoryId.get(category.id) ?? 0,
  }));
}

// capAmount: null clears the category's cap (deletes the budget doc) instead
// of setting one -- lets the Conta page's "apagar valor e salvar" gesture map
// directly onto "stop tracking this category" without a separate control.
export async function setCategoryBudget(
  userId: string,
  categoryId: string,
  capAmount: number | null,
  monthParam?: string
): Promise<{ categoryId: string; capAmount: string | null }> {
  const groupId = await requireGroupId(userId);
  if (!(await categoryIsVisibleTo(categoryId, groupId))) {
    throw new InvalidCategoryError();
  }
  const { periodMonth } = parseMonthRange(monthParam);

  if (capAmount === null) {
    await deleteCategoryBudget(groupId, periodMonth, categoryId);
    return { categoryId, capAmount: null };
  }
  if (capAmount <= 0) {
    throw new InvalidCapAmountError();
  }
  const budget = await upsertCategoryBudget({ groupId, periodMonth, categoryId, capAmount });
  return { categoryId, capAmount: budget.capAmount };
}
