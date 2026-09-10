import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { insertCategory } from "../categories/categories.repository";
import { upsertGroupBudget } from "../budgets/budgets.repository";
import { createTransaction } from "../transactions/transactions.service";
import { addMonths } from "../../utils/month";
import { getAlertsForUser } from "./alerts.service";

const currentMonth = new Date().toISOString().slice(0, 7);

describe("getAlertsForUser", () => {
  it("flags a group that has already spent past its budget cap this month", async () => {
    const { groupId, userAId, jointAccountId } = await createTestGroup();

    await upsertGroupBudget({ groupId, periodMonth: `${currentMonth}-01`, capAmount: 100 });
    await createTransaction(userAId, {
      accountId: jointAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Mercado",
      amount: 150,
      transactionType: "expense",
      occurredAt: new Date().toISOString().slice(0, 10),
      isPrivate: false,
      splitType: "none",
    });

    const alerts = await getAlertsForUser(userAId);
    expect(alerts.some((a) => a.id === "budget-exceeded" && a.severity === "critical")).toBe(true);
  });

  it("flags a category spending well above its 3-month average, but not one with no history", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const spikingCategory = await insertCategory({ groupId, name: "Lazer", emoji: "🎮" });
    const newCategory = await insertCategory({ groupId, name: "Pets", emoji: "🐾" });

    for (const monthsAgo of [1, 2, 3]) {
      await createTransaction(userAId, {
        accountId: personalAccountId,
        categoryId: spikingCategory.id,
        payerId: userAId,
        description: "Lazer de sempre",
        amount: 60,
        transactionType: "expense",
        occurredAt: `${addMonths(currentMonth, -monthsAgo)}-05`,
        isPrivate: false,
        splitType: "none",
      });
    }
    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: spikingCategory.id,
      payerId: userAId,
      description: "Lazer surto",
      amount: 300,
      transactionType: "expense",
      occurredAt: new Date().toISOString().slice(0, 10),
      isPrivate: false,
      splitType: "none",
    });
    // Only ever spent in the current month -- no 3-month baseline to compare
    // against, so this must never "spike" no matter how large the amount.
    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: newCategory.id,
      payerId: userAId,
      description: "Ração",
      amount: 400,
      transactionType: "expense",
      occurredAt: new Date().toISOString().slice(0, 10),
      isPrivate: false,
      splitType: "none",
    });

    const alerts = await getAlertsForUser(userAId);
    expect(alerts.some((a) => a.id === `category-spike-${spikingCategory.id}`)).toBe(true);
    expect(alerts.some((a) => a.id === `category-spike-${newCategory.id}`)).toBe(false);
  });
});
