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
  StatementAlreadyPaidError,
  addPurchase,
  adjustSecuredLimit,
  createCard,
  getStatement,
  listCards,
  listStatements,
  removeCard,
  removePurchase,
  setCardScopeForUser,
  setSecuredSourceForUser,
  setStatementPaidForUser,
  updateCardForUser,
  updatePurchase,
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

    // Pagar a fatura do primeiro mês libera só a parcela daquele mês -- as
    // outras duas, de meses futuros, continuam prendendo o limite.
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

  it("editing an installment renames every open installment but changes only its own amount", async () => {
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

    const edited = await updatePurchase(userAId, card.id, installments[0].id, {
      description: "Geladeira nova",
      amount: 120,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: "2000-01-01", // ignorado numa parcelada
    });
    expect(edited.amount).toBe("120.00");
    expect(edited.purchaseDate).toBe(todayISO);

    const third = await getStatement(userAId, card.id, installments[2].statementMonth);
    expect(third.purchases[0].description).toBe("Geladeira nova");
    expect(third.purchases[0].amount).toBe("100.00");
  });

  it("editing the date of an à vista purchase moves it to the right statement, and paid ones can't be edited", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Nubank",
      closingDay: 10,
      dueDay: 20,
      scope: "personal",
      limit: null,
      limitType: "normal",
    });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Doce",
      amount: 12,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: "2030-03-05",
      installments: 1,
    });
    expect(purchase.statementMonth).toBe("2030-03");

    const moved = await updatePurchase(userAId, card.id, purchase.id, {
      description: "Doce",
      amount: 15,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: "2030-03-15",
    });
    expect(moved.statementMonth).toBe("2030-04");

    const months = await listStatements(userAId, card.id);
    expect(months.find((m) => m.month === "2030-04")?.total).toBe("15.00");
    expect(months.some((m) => m.month === "2030-03")).toBe(false);

    await setStatementPaidForUser(userAId, card.id, "2030-04", true);
    await expect(
      updatePurchase(userAId, card.id, purchase.id, {
        description: "Doce",
        amount: 20,
        categoryId: null,
        buyerId: userAId,
        purchaseDate: "2030-03-15",
      })
    ).rejects.toBeInstanceOf(StatementAlreadyPaidError);
    expect((await listStatements(userAId, card.id)).find((m) => m.month === "2030-04")?.isPaid).toBe(true);
  });

  it("changing the closing day moves open purchases to the statement the new rule gives", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Nubank",
      closingDay: 9,
      dueDay: 15,
      scope: "personal",
      limit: null,
      limitType: "normal",
    });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Mercado",
      amount: 50,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: "2030-05-12",
      installments: 1,
    });
    expect(purchase.statementMonth).toBe("2030-06");

    await updateCardForUser(userAId, card.id, { name: "Nubank", closingDay: 20, dueDay: 27 });

    expect((await getStatement(userAId, card.id, "2030-05")).purchases.map((p) => p.id)).toEqual([purchase.id]);
    expect((await getStatement(userAId, card.id, "2030-06")).purchases).toHaveLength(0);
  });

  it("moving a secured group card to personal moves the saved money to the owner's account", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Garantido",
      closingDay: 31,
      dueDay: 5,
      scope: "joint",
      limit: 100,
      limitType: "secured",
      securedFromAccount: true,
    });
    const balances = async () => {
      const group = (await getGroupForUser(userAId))!;
      return {
        personal: Number(group.accounts.find((a) => a.type === "personal" && a.ownerUserId === userAId)!.balance),
        joint: Number(group.accounts.find((a) => a.type === "joint")!.balance),
      };
    };
    expect(await balances()).toEqual({ personal: 0, joint: -100 });

    const moved = await setCardScopeForUser(userAId, card.id, "personal");
    expect(moved.ownerUserId).toBe(userAId);
    expect(await balances()).toEqual({ personal: -100, joint: 0 });
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

    // Não é gasto: fica fora dos relatórios, mas o número principal sabe que
    // saiu da conta.
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

    // Corrigir depois funciona nos dois sentidos.
    await setSecuredSourceForUser(userAId, card.id, true);
    expect(await balance()).toBe(-300);
    const fixed = await setSecuredSourceForUser(userAId, card.id, false);
    expect(fixed.securedFromAccount).toBe(false);
    expect(fixed.limit).toBe("300.00");
    expect(await balance()).toBe(0);
  });
});
