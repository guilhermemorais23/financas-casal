import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { getAlertsForUser } from "../alerts/alerts.service";
import { getGroupForUser } from "../groups/groups.service";
import { todayInBrazil } from "../loans/loans.service";
import { getUpcomingForUser } from "../upcoming/upcoming.service";
import {
  createTransaction,
  listTransactions,
  splitTransactionByCategoryForUser,
  InvalidCategorySplitError,
} from "../transactions/transactions.service";
import {
  StatementAlreadyPaidError,
  addPurchase,
  adjustSecuredLimit,
  createCard,
  getCreditCardPreferenceForUser,
  getStatement,
  moveTransactionToCard,
  removeCard,
  setCreditCardPreferenceForUser,
  setSavingsPlanForUser,
  setStatementPaidForUser,
  updatePurchase,
} from "./cards.service";
import { db } from "../../db/firestore";

const todayISO = new Date().toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function expense(userId: string, accountId: string, amount: number, categoryId: string | null = null) {
  return createTransaction(userId, {
    accountId,
    categoryId,
    payerId: userId,
    description: "Mercado",
    amount,
    transactionType: "expense",
    occurredAt: todayISO,
    isPrivate: false,
    splitType: "none",
    paymentMethod: "credit",
  });
}

async function category(groupId: string, name: string) {
  const ref = await db.collection("categories").add({ groupId, name, emoji: null });
  return ref.id;
}

describe("dividir lançamento por categoria", () => {
  it("vira dois lançamentos que somam o valor original", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const food = await category(groupId, "Alimentação");
    const home = await category(groupId, "Casa");
    const tx = await expense(userAId, personalAccountId, 200, food);

    await expect(
      splitTransactionByCategoryForUser(userAId, tx.id, [
        { amount: 150, categoryId: food },
        { amount: 40, categoryId: home },
      ])
    ).rejects.toBeInstanceOf(InvalidCategorySplitError);

    const parts = await splitTransactionByCategoryForUser(userAId, tx.id, [
      { amount: 150, categoryId: food },
      { amount: 50, categoryId: home },
    ]);
    expect(parts.map((p) => [p.amount, p.categoryId, p.description])).toEqual([
      ["150.00", food, "Mercado"],
      ["50.00", home, "Mercado"],
    ]);
    const balance = (await getGroupForUser(userAId))!.accounts.find((a) => a.id === personalAccountId)!.balance;
    expect(balance).toBe(-200);
  });
});

describe("mover despesa pro cartão", () => {
  it("tira da conta e vira compra parcelada na fatura", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const tx = await expense(userAId, personalAccountId, 300);

    const purchases = await moveTransactionToCard(userAId, card.id, { transactionId: tx.id, installments: 3 });
    expect(purchases).toHaveLength(3);
    expect(purchases[0].amount).toBe("100.00");
    expect(await listTransactions(userAId, 10)).toHaveLength(0);
    const balance = (await getGroupForUser(userAId))!.accounts.find((a) => a.id === personalAccountId)!.balance;
    expect(balance).toBe(0);
  });
});

describe("editar compra do cartão", () => {
  it("muda nome e categoria em todas as parcelas, e refaz a compra quando o valor muda", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const [first] = await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });

    const renamed = await updatePurchase(userAId, card.id, first.id, {
      description: "Tênis de corrida",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 3,
    });
    expect(renamed.map((p) => p.description)).toEqual(["Tênis de corrida", "Tênis de corrida", "Tênis de corrida"]);

    const redone = await updatePurchase(userAId, card.id, first.id, {
      description: "Tênis de corrida",
      amount: 240,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO,
      installments: 2,
    });
    expect(redone.map((p) => p.amount)).toEqual(["120.00", "120.00"]);
    const statement = await getStatement(userAId, card.id, redone[0].statementMonth);
    expect(statement.purchases).toHaveLength(1);

    await setStatementPaidForUser(userAId, card.id, redone[0].statementMonth, true);
    await expect(
      updatePurchase(userAId, card.id, redone[0].id, {
        description: "Tênis de corrida",
        amount: 200,
        categoryId: null,
        buyerId: userAId,
        purchaseDate: todayISO,
        installments: 2,
      })
    ).rejects.toBeInstanceOf(StatementAlreadyPaidError);
  });
});

describe("cartão padrão do crédito", () => {
  it("fica no perfil e volta a null quando o cartão é apagado", async () => {
    const { userAId } = await createTestGroup();
    expect(await getCreditCardPreferenceForUser(userAId)).toBeNull();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    await setCreditCardPreferenceForUser(userAId, card.id);
    expect(await getCreditCardPreferenceForUser(userAId)).toBe(card.id);
    await removeCard(userAId, card.id);
    expect(await getCreditCardPreferenceForUser(userAId)).toBeNull();
    await setCreditCardPreferenceForUser(userAId, "none");
    expect(await getCreditCardPreferenceForUser(userAId)).toBe("none");
  });
});

describe("guardar todo mês no garantido", () => {
  it("aparece no Vence logo até guardar no mês", async () => {
    const { userAId } = await createTestGroup();
    const today = todayInBrazil();
    const card = await createCard(userAId, {
      name: "Poupança",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: 292,
      limitType: "secured",
      securedFromAccount: false,
    });
    await setSavingsPlanForUser(userAId, card.id, { amount: 200, day: Number(today.slice(8, 10)) });

    const before = await getUpcomingForUser(userAId);
    expect(before.find((item) => item.kind === "savings")).toMatchObject({ amount: 200, daysUntil: 0 });

    await adjustSecuredLimit(userAId, card.id, { direction: "deposit", amount: 200 });
    const after = await getUpcomingForUser(userAId);
    expect(after.find((item) => item.kind === "savings")).toBeUndefined();
  });
});

describe("fatura antes do salário", () => {
  it("avisa quando a fatura vence antes do salário e as contas não cobrem", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const today = todayInBrazil();
    // A fatura atual do cartão é calculada com a data UTC (currentStatementMonth).
    const utcToday = new Date().toISOString().slice(0, 10);
    const dueDate = addDays(utcToday, 4);
    const card = await createCard(userAId, {
      name: "Poupança",
      closingDay: Number(utcToday.slice(8, 10)),
      dueDay: Number(dueDate.slice(8, 10)),
      scope: "personal",
      limit: 292,
      limitType: "secured",
      securedFromAccount: false,
    });
    await addPurchase(userAId, card.id, {
      description: "Compras",
      amount: 292,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: utcToday,
      installments: 1,
    });
    // Salário recorrente começando depois do vencimento: a série inteira já
    // entra no saldo, mas não é dinheiro que está lá hoje.
    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Salário",
      amount: 2500,
      transactionType: "income",
      occurredAt: addDays(today, 7),
      isPrivate: false,
      splitType: "none",
      recurring: { months: 3 },
    });

    const alerts = await getAlertsForUser(userAId);
    const gap = alerts.find((alert) => alert.id === `card-before-salary-${card.id}`);
    expect(gap?.message).toContain("antes do salário");
    expect(gap?.message).toContain("usa o dinheiro guardado");
  });
});
