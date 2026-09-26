import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { insertCategory } from "../categories/categories.repository";
import { findRulesByGroup } from "../statements/importRules.repository";
import { createTransaction } from "./transactions.service";
import { InvalidCategorizeError, categorizeTransactions, listUncategorized } from "./uncategorized";

describe("sem categoria", () => {
  it("agrupa os gastos do mês sem categoria pelo nome e categoriza todos de uma vez", async () => {
    const { groupId, userAId, userBId, personalAccountId } = await createTestGroup();
    const today = todayISO();
    const month = today.slice(0, 7);
    const base = { accountId: personalAccountId, payerId: userAId, occurredAt: today, isPrivate: false, splitType: "none" as const };
    await createTransaction(userAId, { ...base, categoryId: null, description: "PADARIA SOL", amount: 10, transactionType: "expense" });
    await createTransaction(userAId, { ...base, categoryId: null, description: "Padaria Sol", amount: 15, transactionType: "expense" });
    await createTransaction(userAId, { ...base, categoryId: null, description: "Salário", amount: 3000, transactionType: "income" });
    const food = await insertCategory({ groupId, name: "Mercado", emoji: null });
    await createTransaction(userAId, { ...base, categoryId: food.id, description: "Feira", amount: 30, transactionType: "expense" });

    const list = await listUncategorized(userAId, month);
    expect(list.count).toBe(2);
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]).toMatchObject({ count: 2, total: "25.00" });
    // Da conta pessoal de A: B não vê pra categorizar.
    expect((await listUncategorized(userBId, month)).count).toBe(0);

    await expect(categorizeTransactions(userAId, { transactionIds: list.groups[0].transactionIds })).rejects.toBeInstanceOf(InvalidCategorizeError);
    const result = await categorizeTransactions(userAId, {
      transactionIds: list.groups[0].transactionIds,
      categoryId: food.id,
      remember: true,
      label: list.groups[0].label,
    });
    expect(result.updated).toBe(2);
    expect((await listUncategorized(userAId, month)).count).toBe(0);
    expect((await findRulesByGroup(groupId)).some((r) => r.categoryId === food.id)).toBe(true);
  });
});
