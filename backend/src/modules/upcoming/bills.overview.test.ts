import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { createDebt, setInstallmentPaidForUser, listDebts } from "../debts/debts.service";
import { createRecurringBillForUser } from "../recurringBills/recurringBills.service";
import { todayInBrazil } from "../loans/loans.service";
import { getBillsOverview } from "./upcoming.service";

describe("tela Contas (lista única)", () => {
  it("puts debts and fixed bills in one list by date, with pay actions and paid ones flagged", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const today = todayInBrazil();
    const month = today.slice(0, 7);
    const day = Number(today.slice(8, 10));

    await createDebt(userAId, {
      name: "Carro",
      description: null,
      totalAmount: 1200,
      installmentsCount: 12,
      scope: "personal",
      startMonth: month,
      dueDay: 28,
    });
    await createRecurringBillForUser(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Internet",
      amount: 100,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: Math.min(day + 1, 28),
    });

    const before = await getBillsOverview(userAId);
    const carro = before.items.filter((item) => item.kind === "debt");
    // Dia 28 deste mês e do próximo cabem em 30 dias só às vezes -- no mínimo a parcela 1.
    expect(carro.length).toBeGreaterThanOrEqual(1);
    expect(carro[0]).toMatchObject({ title: "Carro", amount: 100, isPaid: false, pay: { type: "debt" } });
    expect(carro[0].debt).toMatchObject({ installmentNumber: 1, installmentsCount: 12 });
    const internet = before.items.find((item) => item.kind === "recurring");
    if (day < 28) expect(internet).toMatchObject({ title: "Internet", pay: null, isPaid: false });
    const dates = before.items.map((item) => item.dueDate ?? "9999");
    expect([...dates].sort()).toEqual(dates);

    const [debt] = await listDebts(userAId);
    const first = debt.installments.find((i) => i.installmentNumber === 1)!;
    await setInstallmentPaidForUser(userAId, debt.id, first.id, true);

    const after = await getBillsOverview(userAId);
    const paid = after.items.find((item) => item.id === `debt-${debt.id}-${first.id}`);
    expect(paid?.isPaid).toBe(true);
    expect(after.summary.toPay).toBeLessThan(before.summary.toPay);
  });
});
