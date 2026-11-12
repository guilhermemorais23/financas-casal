// "Últimos 7 dias" do Painel: janela que anda -- hoje e os 6 dias antes.
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { addDays, todayInBrazil } from "../../utils/month";
import { createTransaction, getRecentDaysSummaryForUser } from "./transactions.service";

describe("getRecentDaysSummaryForUser", () => {
  it("soma só os gastos de hoje até 6 dias atrás; o de 7 dias atrás já saiu", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const today = todayInBrazil();
    const add = (amount: number, daysAgo: number, transactionType: "expense" | "income" = "expense") =>
      createTransaction(userAId, {
        accountId: personalAccountId,
        categoryId: null,
        payerId: userAId,
        description: "lanche",
        amount,
        transactionType,
        occurredAt: addDays(today, -daysAgo),
        isPrivate: false,
        splitType: "none",
      });
    await add(30, 0);
    await add(20, 6);
    await add(99, 7);
    await add(500, 1, "income");

    const result = await getRecentDaysSummaryForUser(userAId);
    expect(result.from).toBe(addDays(today, -6));
    expect(result.to).toBe(today);
    expect(result.total).toBe("50.00");
    expect(result.byCategory.map((row) => row.total)).toEqual(["50.00"]);
  });

  it("sem gasto na janela: vazio", async () => {
    const { userAId } = await createTestGroup();
    const result = await getRecentDaysSummaryForUser(userAId);
    expect(result.total).toBe("0.00");
    expect(result.byCategory).toEqual([]);
  });
});
