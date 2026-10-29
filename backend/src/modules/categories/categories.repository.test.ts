import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { addPurchase, createCard } from "../cards/cards.service";
import { createDebt } from "../debts/debts.service";
import { createRecurringBillForUser } from "../recurringBills/recurringBills.service";
import { createTransaction, getMonthlySummaryForUser, listTransactions } from "../transactions/transactions.service";
import {
  deleteCategory,
  findCategoryById,
  findVisibleCategories,
  INCOME_CATEGORY_ID,
  insertCategory,
  OTHER_CATEGORY_ID,
  updateCategory,
} from "./categories.repository";

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

    await deleteCategory({ id: category.id, groupId, type: "expense" });
    expect(await findCategoryById(category.id)).toBeNull();
  });

  it("todo grupo enxerga a categoria padrão Outros (criada na leitura se faltar)", async () => {
    const { groupId } = await createTestGroup();
    const outros = (await findVisibleCategories(groupId)).find((c) => c.id === OTHER_CATEGORY_ID);
    expect(outros).toMatchObject({ name: "Outros", isDefault: true, type: "expense" });
  });

  it("excluir categoria de despesa passa pra Outros tudo que usava ela (e não mexe no resto)", async () => {
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
    const rule = await db.collection("importRules").add({ groupId, key: "smart fit", categoryId: apagada.id });

    await deleteCategory({ id: apagada.id, groupId, type: "expense" });

    const categoryOf = async (path: string) => (await db.doc(path).get()).data()?.categoryId;
    expect(await categoryOf(`transactions/${tx.id}`)).toBe(OTHER_CATEGORY_ID);
    expect(await categoryOf(`recurringBills/${bill.id}`)).toBe(OTHER_CATEGORY_ID);
    expect(await categoryOf(`debts/${debt.id}`)).toBe(OTHER_CATEGORY_ID);
    expect(await categoryOf(`cards/${card.id}/purchases/${purchase.id}`)).toBe(OTHER_CATEGORY_ID);
    // Regra de importação fica vazia, não vira Outros.
    expect(await categoryOf(`importRules/${rule.id}`)).toBeNull();
    expect(await categoryOf(`transactions/${txOutra.id}`)).toBe(outra.id);
  });

  it("excluir categoria de receita passa as entradas pra Receita", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const freela = await insertCategory({ groupId, name: "Freela", emoji: null, type: "income" });
    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: freela.id,
      payerId: userAId,
      description: "Site do cliente",
      amount: 900,
      transactionType: "income",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });

    await deleteCategory({ id: freela.id, groupId, type: "income" });

    expect((await db.doc(`transactions/${tx.id}`).get()).data()?.categoryId).toBe(INCOME_CATEGORY_ID);
  });
});

describe("lançamento antigo com categoria apagada", () => {
  it("é lido como Outros (ou Receita) na lista e no resumo, sem gravar nada; sem categoria continua sem", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const academia = await insertCategory({ groupId, name: "Academia", emoji: null });
    const freela = await insertCategory({ groupId, name: "Freela", emoji: null, type: "income" });
    const base = { accountId: personalAccountId, payerId: userAId, occurredAt: todayISO(), isPrivate: false, splitType: "none" as const };
    const gasto = await createTransaction(userAId, { ...base, categoryId: academia.id, description: "Mensalidade", amount: 120, transactionType: "expense" });
    const outrosAntes = await createTransaction(userAId, { ...base, categoryId: OTHER_CATEGORY_ID, description: "Presente", amount: 60, transactionType: "expense" });
    const entrada = await createTransaction(userAId, { ...base, categoryId: freela.id, description: "Site", amount: 900, transactionType: "income" });
    const semCategoria = await createTransaction(userAId, { ...base, categoryId: null, description: "Lanche", amount: 30, transactionType: "expense" });

    // Como era antes do PR #57: só a categoria some, os lançamentos ficam com o id antigo.
    await db.collection("categories").doc(academia.id).delete();
    await db.collection("categories").doc(freela.id).delete();

    const month = todayISO().slice(0, 7);
    const rows = await listTransactions(userAId, 100, month);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(gasto.id)).toMatchObject({ categoryId: OTHER_CATEGORY_ID, categoryName: "Outros" });
    expect(byId.get(entrada.id)).toMatchObject({ categoryId: INCOME_CATEGORY_ID, categoryName: "Receita" });
    expect(byId.get(semCategoria.id)).toMatchObject({ categoryId: null, categoryName: null });
    expect(byId.get(outrosAntes.id)?.categoryId).toBe(OTHER_CATEGORY_ID);

    // No resumo por categoria o gasto antigo soma no mesmo grupo de Outros (120 + 60).
    const summary = await getMonthlySummaryForUser(userAId, month, "visible");
    const outros = summary.byCategory.filter((row) => row.categoryId === OTHER_CATEGORY_ID);
    expect(outros).toHaveLength(1);
    expect(Number(outros[0].total)).toBe(180);
    expect(summary.byCategory.some((row) => row.categoryId === academia.id)).toBe(false);

    // Nada foi gravado: o documento continua com o id antigo.
    expect((await db.doc(`transactions/${gasto.id}`).get()).data()?.categoryId).toBe(academia.id);
  });
});
