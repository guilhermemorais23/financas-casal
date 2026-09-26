import { geminiModel, tokensOf, type GeminiTokens } from "../../utils/gemini";

// Uma chamada só pra IA sugerir a categoria de todos os nomes novos do
// extrato (ENERGISA -> Contas da casa, RAIA DROGASIL -> Saúde...). A pessoa
// continua confirmando; a sugestão só vem marcada. Nomes que a IA não tem
// certeza ficam sem sugestão.

export interface SuggestInput {
  key: string;
  name: string;
  kind: string | null;
  transactionType: "expense" | "income";
  total: string;
}

export interface Suggestion {
  categoryId: string | null;
  notExpense: boolean;
}

const MAX_NAMES = 150;
const TIMEOUT_MS = 15_000;

export async function suggestCategories(
  names: SuggestInput[],
  categories: { id: string; name: string }[],
  apiKey: string,
  onTokens?: (tokens: GeminiTokens) => void
): Promise<Map<string, Suggestion>> {
  const out = new Map<string, Suggestion>();
  const list = names.slice(0, MAX_NAMES);
  if (list.length === 0 || categories.length === 0) return out;

  const prompt = `Você classifica lançamentos de um extrato bancário brasileiro nas categorias de um app de finanças de casal.

Categorias (use o número):
${categories.map((c, i) => `${i + 1}. ${c.name}`).join("\n")}

Lançamentos (um por nome; "entrou" = dinheiro que entrou na conta, "saiu" = que saiu):
${list.map((n, i) => `${i}. [${n.transactionType === "income" ? "entrou" : "saiu"}] ${n.name}${n.kind ? ` (${n.kind})` : ""} — R$ ${n.total}`).join("\n")}

Responda só com JSON: [{"i": índice do lançamento, "c": número da categoria ou null, "n": true ou false}]
- "n": true quando NÃO é gasto nem ganho de verdade: pagamento da fatura do cartão, transferência entre contas da própria pessoa (ex.: "TRANSF SALDO C/SAL P/CC"), aplicação ou resgate de investimento. Aí "c" é null.
- Use uma categoria só quando tiver certeza pelo nome (ex.: ENERGISA/companhia de água = contas da casa; drogaria/farmácia = saúde; posto = transporte; supermercado/hortifruti/padaria = mercado; restaurante/pizzaria/ifood = restaurante; rendimento = rendimentos; salário = salário).
- Pix pra pessoa física (nome de gente) quase nunca dá pra saber: "c": null.
- Na dúvida, "c": null. Não invente categoria.`;

  const model = geminiModel(apiKey, { responseMimeType: "application/json", temperature: 0 });
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
  ]);
  onTokens?.(tokensOf(result));

  let reply: unknown;
  try {
    reply = JSON.parse(result.response.text());
  } catch {
    return out;
  }
  if (!Array.isArray(reply)) return out;
  for (const item of reply as { i?: unknown; c?: unknown; n?: unknown }[]) {
    const index = typeof item?.i === "number" ? item.i : -1;
    const entry = list[index];
    if (!entry) continue;
    const key = `${entry.transactionType}:${entry.key}`;
    if (item.n === true) {
      out.set(key, { categoryId: null, notExpense: true });
      continue;
    }
    const category = typeof item.c === "number" ? categories[item.c - 1] : undefined;
    if (category) out.set(key, { categoryId: category.id, notExpense: false });
  }
  return out;
}
