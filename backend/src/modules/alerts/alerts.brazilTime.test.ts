// Alertas à noite no último dia do mês: o mês do orçamento é o do Brasil.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { upsertGroupBudget } from "../budgets/budgets.repository";
import { createTransaction } from "../transactions/transactions.service";
import { getAlertsForUser } from "./alerts.service";

afterEach(() => {
  vi.useRealTimers();
});

describe("alertas à noite no Brasil", () => {
  it("às 23h30 do dia 30/11 ainda olha o orçamento de novembro", async () => {
    const { groupId, userAId, jointAccountId } = await createTestGroup();
    await upsertGroupBudget({ groupId, periodMonth: "2026-11-01", capAmount: 100 });
    await createTransaction(userAId, {
      accountId: jointAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Mercado",
      amount: 150,
      transactionType: "expense",
      occurredAt: "2026-11-20",
      isPrivate: false,
      splitType: "none",
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-30T23:30:00-03:00"));
    const alerts = await getAlertsForUser(userAId);
    expect(alerts.some((alert) => alert.id === "budget-exceeded")).toBe(true);
  });
});
