import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { insertCategory } from "../categories/categories.repository";
import { createTransaction } from "../transactions/transactions.service";
import { normalizeStatementName } from "./importRules.repository";
import {
  InvalidImportItemError,
  InvalidRuleError,
  StatementParseError,
  commitStatement,
  listImportRules,
  previewStatement,
  removeImportRule,
  saveImportRule,
} from "./statements.service";

function csvFor(date: string, rows: [string, string][]): string {
  return ["Data;Descrição;Valor", ...rows.map(([desc, amount]) => `${date};${desc};${amount}`)].join("\n");
}

describe("previewStatement", () => {
  it("flags rows that already exist and keeps new ones", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const today = todayISO();
    const [year, month, day] = today.split("-");
    const brDate = `${day}/${month}/${year}`;

    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Padaria",
      amount: 18.9,
      transactionType: "expense",
      occurredAt: today,
      isPrivate: false,
      splitType: "none",
    });

    const result = await previewStatement(userAId, {
      content: csvFor(brDate, [
        ["Padaria Central", "-18,90"],
        ["Posto", "-210,00"],
        ["Salário", "4.200,00"],
      ]),
    });

    expect(result.format).toBe("csv");
    expect(result.assumedAllExpenses).toBe(false);
    expect(result.rows.map((r) => [r.description, r.isDuplicate, r.transactionType])).toEqual([
      ["Padaria Central", true, "expense"],
      ["Posto", false, "expense"],
      ["Salário", false, "income"],
    ]);
  });

  it("assumes expenses when every amount is positive", async () => {
    const { userAId } = await createTestGroup();
    const result = await previewStatement(userAId, { content: csvFor("2026-09-15", [["Netflix", "55,90"]]) });
    expect(result.assumedAllExpenses).toBe(true);
    expect(result.rows[0]).toMatchObject({ transactionType: "expense", amount: "55.90" });
  });

  it("suggests the category a known description had before", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Assinaturas", emoji: null });
    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: category.id,
      payerId: userAId,
      description: "Netflix",
      amount: 55.9,
      transactionType: "expense",
      occurredAt: "2026-08-15",
      isPrivate: false,
      splitType: "none",
    });
    const result = await previewStatement(userAId, { content: csvFor("2026-09-15", [["NETFLIX", "-55,90"]]) });
    expect(result.rows[0].suggestedCategoryId).toBe(category.id);
  });

  it("explains an unreadable file", async () => {
    const { userAId } = await createTestGroup();
    await expect(previewStatement(userAId, { content: "isto nao e um extrato" })).rejects.toBeInstanceOf(StatementParseError);
    await expect(previewStatement(userAId, { content: "" })).rejects.toBeInstanceOf(StatementParseError);
  });
});

describe("perguntas por nome e regras", () => {
  it("normaliza o nome ignorando maiúscula, acento e número da loja", () => {
    expect(normalizeStatementName("PAO DE ACUCAR 1204")).toBe("pao de acucar");
    expect(normalizeStatementName("Pão de Açúcar - 0877")).toBe("pao de acucar");
    expect(normalizeStatementName("UBER *TRIP 12AB")).toBe("uber trip");
  });

  it("junta os lançamentos com o mesmo nome e ordena pelo maior total", async () => {
    const { userAId } = await createTestGroup();
    const result = await previewStatement(userAId, {
      content: csvFor("10/09/2026", [
        ["PAO DE ACUCAR 1204", "-100,00"],
        ["UBER TRIP", "-20,00"],
        ["Pão de Açúcar 0877", "-150,00"],
        ["SALARIO", "3.000,00"],
      ]),
    });
    expect(result.groups.map((g) => [g.key, g.transactionType, g.count, g.total])).toEqual([
      ["salario", "income", 1, "3000.00"],
      ["pao de acucar", "expense", 2, "250.00"],
      ["uber trip", "expense", 1, "20.00"],
    ]);
    expect(result.groups[1].rowIndexes).toEqual([0, 2]);
    expect(result.groups.every((g) => g.rule === null)).toBe(true);
  });

  it("guarda as respostas e na próxima importação o nome já chega respondido", async () => {
    const { groupId, userAId, userBId, personalAccountId } = await createTestGroup();
    const mercado = await insertCategory({ groupId, name: "Mercado", emoji: null });
    const result = await commitStatement(
      userAId,
      personalAccountId,
      [{ description: "PAO DE ACUCAR 1204", amount: 100, transactionType: "expense", occurredAt: "2026-09-10", categoryId: mercado.id }],
      [
        { key: "PAO DE ACUCAR 1204", label: "PAO DE ACUCAR 1204", categoryId: mercado.id, notExpense: false },
        { key: "PAG FATURA", label: "PAG FATURA", categoryId: null, notExpense: true },
        { key: "sem resposta", label: "sem resposta", categoryId: null, notExpense: false },
      ]
    );
    expect(result).toEqual({ created: 1, rulesSaved: 2 });

    // O parceiro importa o mesmo mercado noutro dia: já vem com categoria.
    const next = await previewStatement(userBId, {
      content: csvFor("20/09/2026", [
        ["Pao de Acucar 0877", "-80,00"],
        ["PAG FATURA 09", "-900,00"],
      ]),
    });
    const byKey = Object.fromEntries(next.groups.map((g) => [g.key, g.rule]));
    expect(byKey["pao de acucar"]).toEqual({ categoryId: mercado.id, notExpense: false });
    expect(byKey["pag fatura"]).toEqual({ categoryId: null, notExpense: true });
    expect(next.rows.find((r) => r.groupKey === "pao de acucar")?.suggestedCategoryId).toBe(mercado.id);

    const rules = await listImportRules(userAId);
    expect(rules.map((r) => r.key).sort()).toEqual(["pag fatura", "pao de acucar"]);

    await saveImportRule(userAId, { key: "pag fatura", label: "PAG FATURA", categoryId: mercado.id, notExpense: false });
    expect((await listImportRules(userAId)).find((r) => r.key === "pag fatura")?.categoryId).toBe(mercado.id);
    await expect(saveImportRule(userAId, { key: "x", categoryId: null })).rejects.toBeInstanceOf(InvalidRuleError);

    await removeImportRule(userAId, "pag fatura");
    expect((await listImportRules(userAId)).map((r) => r.key)).toEqual(["pao de acucar"]);
  });

  it("aceita só respostas quando tudo era 'Não é gasto'", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const result = await commitStatement(userAId, personalAccountId, [], [
      { key: "APLICACAO CDB", label: "APLICACAO CDB", categoryId: null, notExpense: true },
    ]);
    expect(result).toEqual({ created: 0, rulesSaved: 1 });
  });

  it("não guarda regra com categoria de outro grupo", async () => {
    const other = await createTestGroup();
    const foreign = await insertCategory({ groupId: other.groupId, name: "Deles", emoji: null });
    const { userAId } = await createTestGroup();
    await expect(saveImportRule(userAId, { key: "mercado", categoryId: foreign.id })).rejects.toBeInstanceOf(InvalidRuleError);
  });
});

describe("commitStatement", () => {
  it("creates one transaction per reviewed row", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const result = await commitStatement(userAId, personalAccountId, [
      { description: "Padaria", amount: 18.9, transactionType: "expense", occurredAt: "2026-09-20", categoryId: null },
      { description: "Pix Ana", amount: 150, transactionType: "income", occurredAt: "2026-09-16", categoryId: null },
    ]);
    expect(result.created).toBe(2);
  });

  it("rejects malformed items without saving anything", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    await expect(
      commitStatement(userAId, personalAccountId, [
        { description: "ok", amount: 10, transactionType: "expense", occurredAt: "2026-09-20", categoryId: null },
        { description: "ruim", amount: -5, transactionType: "expense", occurredAt: "2026-09-20", categoryId: null },
      ])
    ).rejects.toBeInstanceOf(InvalidImportItemError);
    await expect(commitStatement(userAId, personalAccountId, [])).rejects.toBeInstanceOf(InvalidImportItemError);
  });
});
