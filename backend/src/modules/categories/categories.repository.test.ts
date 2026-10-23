import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { addPurchase, createCard } from "../cards/cards.service";
import { createDebt } from "../debts/debts.service";
import { createRecurringBillForUser } from "../recurringBills/recurringBills.service";
import { createTransaction } from "../transactions/transactions.service";
import { deleteCategory, findCategoryById, insertCategory, updateCategory } from "./categories.repository";

describe("updateCategory / deleteCategory", () => {
  it("renames and re-emojis a category, keeping its doc id", async () => {
    const { groupId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Lazer", emoji: "🎮" });

    const renamed = await updateCategory(category.id, { name: "Lazer 2", emoji: "🎯" });
    expect(renamed.id).toBe(category.id);
    expect(renamed.name).toBe("Lazer 2");
    expect(renamed.emoji).toBe("🎯");
  });

  it("deletes a category", async () => {
    const { groupId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Temporária", emoji: null });

    await deleteCategory(category.id, groupId);
    expect(await findCategoryById(category.id)).toBeNull();
  });

  it("excluir a categoria deixa sem categoria tudo que usava ela (e não mexe no resto)", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const apagada = await insertCategory({ groupId, name: "Academia", emoji: null });
    const outra = await insertCategory({ groupId, name: "Mercado", emoji: null });

    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: apagada.id,
      payerId: userAId,
      description: "Mensalidade",
      amount: 120,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });
    const txOutra = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: outra.id,
      payerId: userAId,
      description: "Feira",
      amount: 80,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });
    const bill = await createRecurringBillForUser(userAId, {
      accountId: personalAccountId,
      categoryId: apagada.id,
      payerId: userAId,
      description: "Academia",
      amount: 120,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: 10,
    });
    const debt = await createDebt(userAId, {
      name: "Matrícula",
      description: null,
      totalAmount: 50,
      installmentsCount: 1,
      scope: "personal",
      startMonth: todayISO().slice(0, 7),
      dueDay: 10,
      categoryId: apagada.id,
    });
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Tênis de corrida",
      amount: 300,
      categoryId: apagada.id,
      buyerId: userAId,
      purchaseDate: todayISO(),
      installments: 1,
    });

    await deleteCategory(apagada.id, groupId);

    const categoryOf = async (path: string) => (await db.doc(path).get()).data()?.categoryId;
    expect(await categoryOf(`transactions/${tx.id}`)).toBeNull();
    expect(await categoryOf(`recurringBills/${bill.id}`)).toBeNull();
    expect(await categoryOf(`debts/${debt.id}`)).toBeNull();
    expect(await categoryOf(`cards/${card.id}/purchases/${purchase.id}`)).toBeNull();
    expect(await categoryOf(`transactions/${txOutra.id}`)).toBe(outra.id);
  });
});
