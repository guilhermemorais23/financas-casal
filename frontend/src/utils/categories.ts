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

// Subcategorias (função Planilha): "Hipoteca" dentro de "Casa". Na lista de
// escolher, cada uma vem logo depois da de cima, como "Casa › Hipoteca".
export function withSubcategories<T extends { id: string; name: string; parentId?: string | null }>(
  categories: T[]
): (T & { label: string })[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const tops = categories.filter((category) => !category.parentId || !byId.has(category.parentId));
  return tops.flatMap((top) => [
    { ...top, label: top.name },
    ...categories
      .filter((child) => child.parentId === top.id)
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      .map((child) => ({ ...child, label: `${top.name} › ${child.name}` })),
  ]);
}

// "remédio, #Mãe" -> ["remédio", "mãe"] (mesma regra do servidor).
export function parseTagsInput(text: string): string[] {
  const tags: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ").toLowerCase().slice(0, 30);
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 10);
}
