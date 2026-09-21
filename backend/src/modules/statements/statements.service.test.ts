import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { insertCategory } from "../categories/categories.repository";
import { createTransaction } from "../transactions/transactions.service";
import { InvalidImportItemError, StatementParseError, commitStatement, previewStatement } from "./statements.service";

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

    const result = await previewStatement(
      userAId,
      csvFor(brDate, [
        ["Padaria Central", "-18,90"],
        ["Posto", "-210,00"],
        ["Salário", "4.200,00"],
      ])
    );

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
    const result = await previewStatement(userAId, csvFor("2026-09-15", [["Netflix", "55,90"]]));
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
    const result = await previewStatement(userAId, csvFor("2026-09-15", [["NETFLIX", "-55,90"]]));
    expect(result.rows[0].suggestedCategoryId).toBe(category.id);
  });

  it("explains an unreadable file", async () => {
    const { userAId } = await createTestGroup();
    await expect(previewStatement(userAId, "isto nao e um extrato")).rejects.toBeInstanceOf(StatementParseError);
    await expect(previewStatement(userAId, "")).rejects.toBeInstanceOf(StatementParseError);
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
