// Função Planilha: subcategorias, marcações, a planilha do ano, importar a
// planilha antiga (e desfazer) e a parcela combinada do empréstimo.
import { describe, expect, it } from "vitest";
import { createSoloTestGroup } from "../../test-helpers";
import { insertCategory } from "../categories/categories.repository";
import { createLoan } from "../loans/loans.service";
import { createTransaction, getRecentDaysSummaryForUser } from "../transactions/transactions.service";
import { defaultModules } from "../users/preferences";
import { todayInBrazil } from "../../utils/month";
import { parseTags } from "../../utils/validation";
import { getSheet, importSheet, listSheetEntries, parseImportBody, undoSheetImport } from "./sheet.service";

async function setup() {
  const solo = await createSoloTestGroup();
  const casa = await insertCategory({ groupId: solo.groupId, name: "Casa", emoji: null });
  const hipoteca = await insertCategory({ groupId: solo.groupId, name: "Hipoteca", emoji: null, parentId: casa.id });
  const add = (input: { amount: number; occurredAt: string; categoryId?: string | null; tags?: string[]; type?: "expense" | "income"; description?: string }) =>
    createTransaction(solo.userId, {
      accountId: solo.personalAccountId,
      categoryId: input.categoryId ?? null,
      payerId: solo.userId,
      description: input.description ?? "lançamento",
      amount: input.amount,
      transactionType: input.type ?? "expense",
      occurredAt: input.occurredAt,
      isPrivate: false,
      splitType: "none",
      tags: input.tags,
    });
  return { ...solo, casa, hipoteca, add };
}

describe("Planilha começa desligada", () => {
  it("pra quem não respondeu e pra quem respondeu", () => {
    expect(defaultModules(null, []).sheet).toBe(false);
    expect(defaultModules("solo", ["spending"]).sheet).toBe(false);
    expect(defaultModules(null, []).reports).toBe(true);
  });
});

describe("marcações", () => {
  it("tira #, põe em minúscula e não repete", () => {
    expect(parseTags(["#Remédio", "remédio", " Mãe ", ""])).toEqual(["remédio", "mãe"]);
    expect(parseTags(undefined)).toBeUndefined();
    expect(parseTags("remédio")).toBeNull();
    expect(parseTags(["x".repeat(31)])).toBeNull();
  });
});

describe("subcategoria", () => {
  it("o id leva a categoria de cima e o tipo vem dela", async () => {
    const { hipoteca, casa } = await setup();
    expect(hipoteca.parentId).toBe(casa.id);
    expect(hipoteca.id).toContain("casa__hipoteca");
  });

  it("no Painel soma na categoria de cima", async () => {
    const { add, hipoteca, casa, userId } = await setup();
    const today = todayInBrazil();
    await add({ amount: 100, occurredAt: today, categoryId: hipoteca.id });
    await add({ amount: 50, occurredAt: today, categoryId: casa.id });
    const summary = await getRecentDaysSummaryForUser(userId);
    expect(summary.byCategory).toEqual([expect.objectContaining({ categoryId: casa.id, total: "150.00" })]);
  });
});

describe("getSheet", () => {
  it("cada categoria e subcategoria em cada mês, receitas à parte, e as marcações", async () => {
    const { add, hipoteca, casa, userId } = await setup();
    await add({ amount: 2850, occurredAt: "2026-03-05", categoryId: hipoteca.id });
    await add({ amount: 2850, occurredAt: "2026-04-05", categoryId: hipoteca.id });
    await add({ amount: 120, occurredAt: "2026-04-10", categoryId: casa.id, tags: ["urgente"] });
    await add({ amount: 87.4, occurredAt: "2026-04-12", tags: ["remédio"] });
    await add({ amount: 6800, occurredAt: "2026-04-01", type: "income" });
    await add({ amount: 999, occurredAt: "2025-12-31", categoryId: hipoteca.id });

    const sheet = await getSheet(userId, 2026);
    const row = (categoryId: string | null, type = "expense") =>
      sheet.rows.find((r) => r.categoryId === categoryId && r.transactionType === type)!;
    expect(row(hipoteca.id).months.slice(2, 5)).toEqual(["2850.00", "2850.00", "0.00"]);
    expect(row(hipoteca.id).total).toBe("5700.00");
    expect(row(casa.id).months[3]).toBe("120.00");
    expect(row(null).months[3]).toBe("87.40");
    expect(sheet.rows.find((r) => r.transactionType === "income")!.months[3]).toBe("6800.00");
    expect(sheet.tags).toEqual(
      expect.arrayContaining([
        { tag: "remédio", count: 1, total: "87.40" },
        { tag: "urgente", count: 1, total: "120.00" },
      ])
    );
    expect(sheet.categories.some((c) => c.id === hipoteca.id && c.parentId === casa.id)).toBe(true);
  });

  it("o que tem dentro de um valor e de uma marcação", async () => {
    const { add, hipoteca, userId } = await setup();
    await add({ amount: 87.4, occurredAt: "2026-04-12", tags: ["remédio"], description: "Remédio da pressão" });
    await add({ amount: 2850, occurredAt: "2026-04-05", categoryId: hipoteca.id, description: "Parcela da casa" });

    const cell = await listSheetEntries(userId, { year: 2026, month: 4, categoryId: hipoteca.id });
    expect(cell.map((entry) => entry.description)).toEqual(["Parcela da casa"]);
    const none = await listSheetEntries(userId, { year: 2026, month: 4, categoryId: "none" });
    expect(none.map((entry) => [entry.description, entry.tags])).toEqual([["Remédio da pressão", ["remédio"]]]);
    const tagged = await listSheetEntries(userId, { year: 2026, tag: "remédio" });
    expect(tagged).toHaveLength(1);
  });
});

describe("importar a planilha antiga", () => {
  const months = (values: Record<number, number>) => Array.from({ length: 12 }, (_, i) => values[i] ?? null);

  it("cria o que falta, reaproveita o que existe (sem ligar pra acento) e desfaz", async () => {
    const { userId, groupId, personalAccountId, casa } = await setup();
    const input = parseImportBody({
      year: 2026,
      accountId: personalAccountId,
      rows: [
        { group: "casa", name: "Hipoteca", transactionType: "expense", months: months({ 0: 2850, 1: 2850 }) },
        { group: "Casa", name: "Água", transactionType: "expense", months: months({ 0: 118.5 }) },
        { group: null, name: "Aposentadoria", transactionType: "income", months: months({ 0: 6800 }) },
      ],
    });
    const result = await importSheet(userId, input);
    expect(result.created).toBe(4);
    // Casa e Hipoteca já existiam; Água e Aposentadoria são novas.
    expect(result.categoriesCreated).toBe(2);

    const sheet = await getSheet(userId, 2026);
    const agua = sheet.categories.find((c) => c.name === "Água")!;
    expect(agua.parentId).toBe(casa.id);
    expect(sheet.rows.find((r) => r.categoryId === agua.id)!.months[0]).toBe("118.50");
    const entries = await listSheetEntries(userId, { year: 2026, month: 1 });
    expect(entries.every((entry) => entry.date === "2026-01-01" && entry.tags.includes("planilha"))).toBe(true);
    expect(groupId).toBeTruthy();

    expect(await undoSheetImport(userId, result.importId)).toBe(4);
    expect((await getSheet(userId, 2026)).rows).toEqual([]);
  });

  it("recusa linha sem os 12 meses ou com valor negativo", () => {
    expect(() => parseImportBody({ year: 2026, accountId: "a", rows: [{ group: null, name: "X", transactionType: "expense", months: [1] }] })).toThrow(/12 meses/);
    expect(() =>
      parseImportBody({ year: 2026, accountId: "a", rows: [{ group: null, name: "X", transactionType: "expense", months: months({ 0: -5 }) }] })
    ).toThrow(/valor inválido/);
  });
});

describe("empréstimo com parcela combinada", () => {
  it("guarda a parcela; sem ela fica null (paga quando pode)", async () => {
    const { userId } = await createSoloTestGroup();
    const base = { direction: "lent" as const, personName: "Carlos", amount: 6000, lentAt: "2026-01-05", dueDate: null, note: null, accountId: null };
    expect((await createLoan(userId, { ...base, installmentAmount: 500 })).installmentAmount).toBe("500.00");
    expect((await createLoan(userId, { ...base, personName: "Pri" })).installmentAmount).toBeNull();
  });
});
