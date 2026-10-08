// Categoria de despesa x de receita: receita começa só com "Receita".
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { getCategoryBudgets } from "../budgets/budgets.service";
import { findVisibleCategories, insertCategory } from "./categories.repository";

describe("categorias de receita", () => {
  it("todo grupo já tem a categoria padrão Receita, de tipo receita", async () => {
    const { groupId } = await createTestGroup();
    const categories = await findVisibleCategories(groupId);
    const incomes = categories.filter((category) => category.type === "income");
    expect(incomes.map((category) => category.name)).toEqual(["Receita"]);
    expect(incomes[0]).toMatchObject({ id: "global__receita", isDefault: true, groupId: null });
  });

  it("categoria criada sem tipo é de despesa; com type income, de receita", async () => {
    const { groupId } = await createTestGroup();
    const expense = await insertCategory({ groupId, name: "Pet", emoji: null });
    const income = await insertCategory({ groupId, name: "Salário", emoji: null, type: "income" });
    expect(expense.type).toBe("expense");
    expect(income.type).toBe("income");

    const visible = await findVisibleCategories(groupId);
    expect(visible.find((category) => category.id === income.id)?.type).toBe("income");
    expect(visible.find((category) => category.id === expense.id)?.type).toBe("expense");
  });

  it("orçamento por categoria não lista as de receita", async () => {
    const { groupId, userAId } = await createTestGroup();
    await insertCategory({ groupId, name: "Freela", emoji: null, type: "income" });
    const budgets = await getCategoryBudgets(userAId);
    const names = budgets.map((row) => row.categoryName);
    expect(names).not.toContain("Receita");
    expect(names).not.toContain("Freela");
  });
});
