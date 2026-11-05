// "Vence logo" do Painel: uma fatura antiga do cartão que ficou sem pagar
// (atrasada) tem que aparecer, como já aparece em Contas e no A receber.
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { addPurchase, createCard } from "../cards/cards.service";
import { todayInBrazil } from "../../utils/month";
import { getUpcomingForUser } from "./upcoming.service";

function daysAgo(days: number): string {
  const date = new Date(`${todayInBrazil()}T12:00:00`);
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

describe("Vence logo", () => {
  it("mostra a fatura antiga do cartão que ficou em aberto", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 1, dueDay: 10, scope: "personal", limit: 5000, limitType: "normal" });
    await addPurchase(userAId, card.id, { description: "Mercado", amount: 200, categoryId: null, buyerId: userAId, purchaseDate: daysAgo(70), installments: 1 });

    const items = await getUpcomingForUser(userAId);

    const overdue = items.filter((item) => item.kind === "card" && item.daysUntil < 0);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]).toMatchObject({ title: "Fatura Nubank", amount: 200 });
  });
});
