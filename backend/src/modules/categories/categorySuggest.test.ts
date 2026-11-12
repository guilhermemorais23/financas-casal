// Sugestão de categoria ao lançar: histórico do grupo primeiro, depois palavra-chave.
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { createTransaction } from "../transactions/transactions.service";
import { OTHER_CATEGORY_ID, findVisibleCategories, insertCategory } from "./categories.repository";
import { isSimilarDescription, normalizeText, suggestCategory } from "./categorySuggest";

// As padrão vêm do script de seed, que os testes não rodam: cria a de
// Transporte com o mesmo id e formato dele.
const TRANSPORT_ID = "global__transporte";

beforeAll(async () => {
  await db.collection("categories").doc(TRANSPORT_ID).set({ groupId: null, name: "Transporte", emoji: "🚗", isDefault: true });
});

function add(
  userId: string,
  accountId: string,
  description: string,
  categoryId: string | null,
  extra: { isPrivate?: boolean; occurredAt?: string } = {}
) {
  return createTransaction(userId, {
    accountId,
    categoryId,
    payerId: userId,
    description,
    amount: 20,
    transactionType: "expense",
    occurredAt: extra.occurredAt ?? todayISO(),
    isPrivate: extra.isPrivate ?? false,
    splitType: "none",
  });
}

describe("normalizeText / isSimilarDescription", () => {
  it("ignora acento, maiúscula e espaço sobrando", () => {
    expect(normalizeText("  Farmácia   São  João ")).toBe("farmacia sao joao");
  });

  it("parecida = igual ou começo da outra, com ao menos 3 letras", () => {
    expect(isSimilarDescription("mercado", "mercado extra")).toBe(true);
    expect(isSimilarDescription("mercado extra", "mercado")).toBe(true);
    expect(isSimilarDescription("me", "mercado")).toBe(false);
    expect(isSimilarDescription("padaria", "mercado")).toBe(false);
  });
});

describe("suggestCategory", () => {
  it("o histórico do grupo ganha da palavra-chave", async () => {
    const { groupId, userAId, userBId, jointAccountId } = await createTestGroup();
    const apps = await insertCategory({ groupId, name: "Apps", emoji: null });
    await add(userAId, jointAccountId, "Uber pro trabalho", apps.id);

    // Até o par, que não lançou, recebe o palpite do histórico conjunto.
    expect(await suggestCategory(groupId, userBId, "uber", "expense")).toEqual({ categoryId: apps.id, source: "history" });
  });

  it("o mais recente ganha", async () => {
    const { groupId, userAId, jointAccountId } = await createTestGroup();
    const a = await insertCategory({ groupId, name: "Casa", emoji: null });
    const b = await insertCategory({ groupId, name: "Feira", emoji: null });
    await add(userAId, jointAccountId, "Hortifruti", a.id, { occurredAt: "2026-01-01" });
    await add(userAId, jointAccountId, "hortifrúti", b.id, { occurredAt: "2026-02-01" });
    expect(await suggestCategory(groupId, userAId, "Hortifruti", "expense")).toEqual({ categoryId: b.id, source: "history" });
  });

  it("sem histórico, a palavra-chave casa com a categoria padrão", async () => {
    const { groupId, userAId } = await createTestGroup();
    expect(await suggestCategory(groupId, userAId, "Gasolina posto", "expense")).toEqual({
      categoryId: TRANSPORT_ID,
      source: "keyword",
    });
    // Palavra inteira: "barbearia" não é "bar".
    expect(await suggestCategory(groupId, userAId, "barbearia", "expense")).toEqual({ categoryId: null, source: null });
  });

  it("descrição vazia ou de uma letra, ou sem palpite: null", async () => {
    const { groupId, userAId } = await createTestGroup();
    expect(await suggestCategory(groupId, userAId, "", "expense")).toEqual({ categoryId: null, source: null });
    expect(await suggestCategory(groupId, userAId, " a ", "expense")).toEqual({ categoryId: null, source: null });
    expect(await suggestCategory(groupId, userAId, "xyzw", "expense")).toEqual({ categoryId: null, source: null });
  });

  it("não usa lançamento de outro grupo nem o privado de outra pessoa", async () => {
    const other = await createTestGroup();
    // Uma categoria padrão (que o meu grupo também enxerga): se o histórico
    // vazasse entre grupos, o palpite seria "Outros".
    await findVisibleCategories(other.groupId);
    await add(other.userAId, other.jointAccountId, "Uber noturno", OTHER_CATEGORY_ID);

    const { groupId, userAId, userBId, jointAccountId } = await createTestGroup();
    const hidden = await insertCategory({ groupId, name: "Escondida", emoji: null });
    await add(userAId, jointAccountId, "Uber noturno", hidden.id, { isPrivate: true });

    // Pra B, o privado de A não existe: cai na palavra-chave.
    expect(await suggestCategory(groupId, userBId, "Uber noturno", "expense")).toEqual({
      categoryId: TRANSPORT_ID,
      source: "keyword",
    });
    // Quem lançou o privado vê o próprio histórico.
    expect(await suggestCategory(groupId, userAId, "Uber noturno", "expense")).toEqual({
      categoryId: hidden.id,
      source: "history",
    });
  });

  it("receita: salário cai na categoria Receita", async () => {
    const { groupId, userAId } = await createTestGroup();
    expect(await suggestCategory(groupId, userAId, "Salário março", "income")).toEqual({
      categoryId: "global__receita",
      source: "keyword",
    });
  });
});
