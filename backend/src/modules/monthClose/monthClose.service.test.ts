import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { createTransaction } from "../transactions/transactions.service";
import { getMonthCloseForUser, previousMonthInBrazil } from "./monthClose.service";

describe("fechamento do mês", () => {
  it("resume entrou, saiu, sobrou e compara com o mês anterior", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const base = {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      isPrivate: false,
      splitType: "none" as const,
    };
    await createTransaction(userAId, { ...base, description: "Salário", amount: 3000, transactionType: "income", occurredAt: "2026-03-05" });
    await createTransaction(userAId, { ...base, description: "Mercado", amount: 700, transactionType: "expense", occurredAt: "2026-03-10" });
    await createTransaction(userAId, { ...base, description: "Salário", amount: 2500, transactionType: "income", occurredAt: "2026-02-05" });
    await createTransaction(userAId, { ...base, description: "Aluguel", amount: 2000, transactionType: "expense", occurredAt: "2026-02-10" });

    const close = await getMonthCloseForUser(userAId, "2026-03");
    expect(close).toMatchObject({
      month: "2026-03",
      income: 3000,
      expense: 700,
      left: 2300,
      previousMonth: "2026-02",
      previousLeft: 500,
      hasActivity: true,
    });
    expect(close.topCategories[0]).toEqual({ name: "Sem categoria", total: 700 });
  });

  it("mês sem lançamento não tem atividade (não manda email)", async () => {
    const { userAId } = await createTestGroup();
    const close = await getMonthCloseForUser(userAId, "2025-01");
    expect(close.hasActivity).toBe(false);
    expect(close.left).toBe(0);
  });

  it("sem mês informado, usa o mês passado no fuso de Brasília", () => {
    // 1º de outubro às 02h UTC ainda é 30 de setembro em Brasília.
    expect(previousMonthInBrazil(new Date("2026-10-01T02:00:00Z"))).toBe("2026-08");
    expect(previousMonthInBrazil(new Date("2026-10-01T12:00:00Z"))).toBe("2026-09");
  });
});
