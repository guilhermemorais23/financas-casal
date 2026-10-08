// Categoria de despesa ou de receita. Receita começa só com "Receita" (padrão,
// não dá pra apagar); quem tem outras fontes (salário, freela, aluguel
// recebido) cria as suas. Categoria antiga, sem tipo, é de despesa.
export type CategoryType = "expense" | "income";

export const DEFAULT_INCOME_CATEGORY_ID = "global__receita";

export function categoryTypeOf(category: { type?: CategoryType }): CategoryType {
  return category.type === "income" ? "income" : "expense";
}

export function categoriesFor<T extends { type?: CategoryType }>(categories: T[], type: CategoryType): T[] {
  return categories.filter((category) => categoryTypeOf(category) === type);
}

// Categoria inicial de um lançamento novo desse tipo: receita já vem com
// "Receita" marcada; despesa começa sem categoria.
export function defaultCategoryFor<T extends { id: string; type?: CategoryType }>(categories: T[], type: CategoryType): string {
  if (type !== "income") return "";
  const incomes = categoriesFor(categories, "income");
  return (incomes.find((category) => category.id === DEFAULT_INCOME_CATEGORY_ID) ?? incomes[0])?.id ?? "";
}
