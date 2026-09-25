import { describe, expect, it } from "vitest";
import { paymentsUntil } from "./upcoming.service";

type Input = Parameters<typeof paymentsUntil>[0];

describe("paymentsUntil", () => {
  const cards = [
    // Com limite: cada mês em aberto é um pagamento.
    { limitReleases: [{ dueDate: "2026-10-05", amount: "300.00" }, { dueDate: "2026-11-05", amount: "150.00" }], currentStatement: { isPaid: false, total: "300.00", dueDate: "2026-10-05" } },
    // Sem limite: só a fatura atual, e só se não foi paga.
    { limitReleases: [], currentStatement: { isPaid: false, total: "80.00", dueDate: "2026-10-10" } },
    { limitReleases: [], currentStatement: { isPaid: true, total: "999.00", dueDate: "2026-10-10" } },
  ] as unknown as Input["cards"];
  const debts = [
    { installments: [{ isPaid: true, dueDate: "2026-09-15", amount: "100.00" }, { isPaid: false, dueDate: "2026-10-15", amount: "100.00" }, { isPaid: false, dueDate: null, amount: "100.00" }] },
  ] as unknown as Input["debts"];
  const bills = [
    { isActive: true, transactionType: "expense", dayOfMonth: 28, lastGeneratedMonth: null, amount: "50.00" },
    { isActive: true, transactionType: "expense", dayOfMonth: 1, lastGeneratedMonth: "2026-09", amount: "20.00" },
    { isActive: false, transactionType: "expense", dayOfMonth: 26, lastGeneratedMonth: null, amount: "999.00" },
    { isActive: true, transactionType: "income", dayOfMonth: 26, lastGeneratedMonth: null, amount: "999.00" },
  ] as unknown as Input["bills"];

  it("lists everything due up to the date, in order", () => {
    const items = paymentsUntil({ cards, debts, bills, today: "2026-09-25", until: "2026-10-31" });
    expect(items).toEqual([
      { dueDate: "2026-09-28", amount: 50 },
      { dueDate: "2026-10-01", amount: 20 },
      { dueDate: "2026-10-05", amount: 300 },
      { dueDate: "2026-10-10", amount: 80 },
      { dueDate: "2026-10-15", amount: 100 },
      { dueDate: "2026-10-28", amount: 50 },
    ]);
  });

  it("doesn't count a fixed bill whose day already passed this month", () => {
    const items = paymentsUntil({ cards: [], debts: [], bills, today: "2026-09-29", until: "2026-09-30" });
    expect(items).toEqual([]);
  });
});
