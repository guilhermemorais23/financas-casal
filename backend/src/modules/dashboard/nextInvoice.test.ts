import { describe, expect, it } from "vitest";
import { pickNextInvoice } from "./dashboard.service";

type Cards = Parameters<typeof pickNextInvoice>[0];

function card(over: Record<string, unknown>) {
  return {
    name: "Nubank",
    limit: "1000.00",
    limitUsed: "0.00",
    limitReleases: [],
    currentStatement: { month: "2026-10", isPaid: false, total: "0.00", dueDate: "2026-10-10" },
    ...over,
  };
}

describe("Próxima fatura no Painel", () => {
  it("mostra a fatura em aberto que vence primeiro", () => {
    const cards = [
      card({ name: "Inter", currentStatement: { month: "2026-10", isPaid: false, total: "80.00", dueDate: "2026-10-20" } }),
      card({ name: "Nubank", currentStatement: { month: "2026-10", isPaid: false, total: "300.00", dueDate: "2026-10-10" } }),
    ] as unknown as Cards;
    expect(pickNextInvoice(cards)).toMatchObject({ cardName: "Nubank", total: "300.00", status: "open" });
  });

  it("com a fatura atual paga, mostra a próxima com parcelas", () => {
    const cards = [
      card({
        currentStatement: { month: "2026-10", isPaid: true, total: "300.00", dueDate: "2026-10-10" },
        limitReleases: [{ month: "2026-11", dueDate: "2026-11-10", amount: "100.00", availableAfter: "900.00" }],
      }),
    ] as unknown as Cards;
    expect(pickNextInvoice(cards)).toMatchObject({ dueDate: "2026-11-10", total: "100.00", status: "open" });
  });

  it("sem nada em aberto, o cartão continua aparecendo com o limite", () => {
    const paid = [card({ currentStatement: { month: "2026-10", isPaid: true, total: "300.00", dueDate: "2026-10-10" } })] as unknown as Cards;
    expect(pickNextInvoice(paid)).toMatchObject({ cardName: "Nubank", status: "paid", limit: "1000.00" });

    const empty = [card({})] as unknown as Cards;
    expect(pickNextInvoice(empty)).toMatchObject({ status: "empty", total: "0.00" });

    expect(pickNextInvoice([] as unknown as Cards)).toBeNull();
  });
});
