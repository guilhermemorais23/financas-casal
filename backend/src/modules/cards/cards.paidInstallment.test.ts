// Compra parcelada retroativa: uma parcela não pode cair numa fatura já paga
// (o total dela deixaria de bater com o pagamento lançado).
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { StatementAlreadyPaidError, addPurchase, createCard, setStatementPaidForUser } from "./cards.service";

describe("compra parcelada e fatura paga", () => {
  it("recusa a compra quando uma parcela seguinte cairia numa fatura paga", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 10, dueDay: 20, scope: "personal", limit: null, limitType: "normal" });
    const [paid] = await addPurchase(userAId, card.id, { description: "Mercado", amount: 50, categoryId: null, buyerId: userAId, purchaseDate: "2030-05-05", installments: 1 });
    await setStatementPaidForUser(userAId, card.id, paid.statementMonth, true);

    // Um mês antes: a 1ª parcela cai na fatura anterior (aberta), a 2ª na paga.
    await expect(
      addPurchase(userAId, card.id, { description: "Geladeira", amount: 300, categoryId: null, buyerId: userAId, purchaseDate: "2030-04-05", installments: 3 })
    ).rejects.toBeInstanceOf(StatementAlreadyPaidError);
  });
});
