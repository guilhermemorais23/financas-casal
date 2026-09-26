import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { getGroupForUser } from "../groups/groups.service";
import {
  SecuredCardTransferError,
  deleteTransactionForUser,
  getMonthlySummaryForUser,
  getMonthlyTrendForUser,
  listTransactions,
} from "../transactions/transactions.service";
import {
  InsufficientAvailableLimitError,
  InvalidLimitError,
  NotSecuredCardError,
  addPurchase,
  adjustSecuredLimit,
  createCard,
  getStatement,
  listCards,
  removeCard,
  removePurchase,
  setSecuredSourceForUser,
  setStatementPaidForUser,
  updateCardForUser,
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
      limitType: "normal",
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
      limitType: "normal",
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
      limitType: "normal",
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

describe("cards: limite garantido", () => {
  async function securedCard(limit: number) {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Cartão garantido",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit,
      limitType: "secured",
    });
    return { userAId, card };
  }

  it("needs a first deposit to be created", async () => {
    const { userAId } = await createTestGroup();
    await expect(
      createCard(userAId, {
        name: "Sem depósito",
        closingDay: 31,
        dueDay: 5,
        scope: "personal",
        limit: null,
        limitType: "secured",
      })
    ).rejects.toBeInstanceOf(InvalidLimitError);
  });

  it("deposits raise the limit and withdrawals only take what purchases aren't holding", async () => {
    const { userAId, card } = await securedCard(1000);
    expect(card.limitType).toBe("secured");

    await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 600,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });

    const afterDeposit = await adjustSecuredLimit(userAId, card.id, { direction: "deposit", amount: 500 });
    expect(afterDeposit.limit).toBe("1500.00");

    // 1500 guardados - 600 presos nas parcelas = 900 livres.
    await expect(
      adjustSecuredLimit(userAId, card.id, { direction: "withdraw", amount: 900.01 })
    ).rejects.toBeInstanceOf(InsufficientAvailableLimitError);

    const afterWithdraw = await adjustSecuredLimit(userAId, card.id, { direction: "withdraw", amount: 900 });
    expect(afterWithdraw.limit).toBe("600.00");
  });

  it("lists when each unpaid fatura gives the limit back", async () => {
    const { userAId, card } = await securedCard(1000);
    const installments = await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 600,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });

    const [row] = await listCards(userAId);
    expect(row.limitUsed).toBe("600.00");
    expect(row.limitReleases.map((release) => [release.month, release.amount, release.availableAfter])).toEqual([
      [installments[0].statementMonth, "200.00", "600.00"],
      [installments[1].statementMonth, "200.00", "800.00"],
      [installments[2].statementMonth, "200.00", "1000.00"],
    ]);

    await setStatementPaidForUser(userAId, card.id, installments[0].statementMonth, true);
    const [afterPayment] = await listCards(userAId);
    expect(afterPayment.limitReleases).toHaveLength(2);
    expect(afterPayment.limitReleases[0].availableAfter).toBe("800.00");
  });

  it("refuses deposits on a normal card and direct limit edits on a secured one", async () => {
    const { userAId, card } = await securedCard(1000);
    await expect(
      updateCardForUser(userAId, card.id, { name: "X", closingDay: 31, dueDay: 5, limit: 5000 })
    ).rejects.toBeInstanceOf(NotSecuredCardError);

    const normal = await createCard(userAId, {
      name: "Normal",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: 1000,
      limitType: "normal",
    });
    await expect(
      adjustSecuredLimit(userAId, normal.id, { direction: "deposit", amount: 100 })
    ).rejects.toBeInstanceOf(NotSecuredCardError);
  });

  it("guardar tira da conta como transferência, não como gasto, e volta ao resgatar ou apagar o cartão", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const balance = async () =>
      (await getGroupForUser(userAId))!.accounts.find((account) => account.id === personalAccountId)!.balance;

    const card = await createCard(userAId, {
      name: "Garantido",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: 100,
      limitType: "secured",
    });
    expect(await balance()).toBe(-100);

    // Not spending: out of the reports, but the hero knows it left the account.
    expect((await getMonthlySummaryForUser(userAId, undefined, "visible")).total).toBe("0.00");
    const trend = await getMonthlyTrendForUser(userAId);
    expect(trend[trend.length - 1]).toMatchObject({ expense: 0, savedInCards: 100, net: -100 });

    const [transfer] = await listTransactions(userAId, 10);
    expect(transfer.description).toBe("Guardado no cartão Garantido");
    await expect(deleteTransactionForUser(userAId, transfer.id)).rejects.toBeInstanceOf(SecuredCardTransferError);

    await adjustSecuredLimit(userAId, card.id, { direction: "withdraw", amount: 40 });
    expect(await balance()).toBe(-60);

    await removeCard(userAId, card.id);
    expect(await balance()).toBe(0);
  });

  it("dinheiro que já estava guardado fora do app vira limite a mais, sem mexer na conta", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const balance = async () =>
      (await getGroupForUser(userAId))!.accounts.find((account) => account.id === personalAccountId)!.balance;

    const card = await createCard(userAId, {
      name: "Poupança garantida",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: 292,
      limitType: "secured",
      securedFromAccount: false,
    });
    expect(card.securedFromAccount).toBe(false);
    expect(await balance()).toBe(0);

    await adjustSecuredLimit(userAId, card.id, { direction: "deposit", amount: 8 });
    expect(await balance()).toBe(0);
    const [row] = await listCards(userAId);
    expect(row.limit).toBe("300.00");

    // Fixing it after the fact goes both ways.
    await setSecuredSourceForUser(userAId, card.id, true);
    expect(await balance()).toBe(-300);
    const fixed = await setSecuredSourceForUser(userAId, card.id, false);
    expect(fixed.securedFromAccount).toBe(false);
    expect(fixed.limit).toBe("300.00");
    expect(await balance()).toBe(0);
  });
});
