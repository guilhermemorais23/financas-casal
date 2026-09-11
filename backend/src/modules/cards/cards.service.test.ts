import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import {
  addPurchase,
  createCard,
  getStatement,
  listCards,
  removePurchase,
  setStatementPaidForUser,
} from "./cards.service";

const todayISO = new Date().toISOString().slice(0, 10);

describe("cards: limite e parcelamento", () => {
  it("locks the full parcelado amount against the limit, and frees only a paid month's share", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Nubank",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: 300,
    });

    const installments = await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });
    expect(installments).toHaveLength(3);
    expect(installments.map((p) => p.amount)).toEqual(["100.00", "100.00", "100.00"]);
    expect(new Set(installments.map((p) => p.purchaseGroupId)).size).toBe(1);

    const [cardAfterPurchase] = await listCards(userAId);
    expect(cardAfterPurchase.limitUsed).toBe("300.00");

    // Paying off the first month's statement only frees that installment's
    // share -- the other two, due in future months, keep locking the limit.
    const firstMonth = installments[0].statementMonth;
    await setStatementPaidForUser(userAId, card.id, firstMonth, true);

    const [cardAfterPayment] = await listCards(userAId);
    expect(cardAfterPayment.limitUsed).toBe("200.00");
  });

  it("deleting one installment removes only that installment", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Nubank",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: null,
    });

    const installments = await addPurchase(userAId, card.id, {
      description: "Geladeira",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });

    await removePurchase(userAId, card.id, installments[1].id);

    const firstMonthStatement = await getStatement(userAId, card.id, installments[0].statementMonth);
    const thirdMonthStatement = await getStatement(userAId, card.id, installments[2].statementMonth);
    expect(firstMonthStatement.purchases).toHaveLength(1);
    expect(thirdMonthStatement.purchases).toHaveLength(1);
  });

  it("a card with no limit set never computes limitUsed", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Cartão sem limite",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: null,
    });
    await addPurchase(userAId, card.id, {
      description: "Mercado",
      amount: 50,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 1,
    });

    const [row] = await listCards(userAId);
    expect(row.limit).toBeNull();
    expect(row.limitUsed).toBeNull();
  });
});
