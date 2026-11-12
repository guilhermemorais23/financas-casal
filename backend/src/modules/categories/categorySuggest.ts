// ============================================================================
// Sugestão de categoria ao lançar (sem IA)
// ============================================================================
// Escolher categoria é o passo que mais cansa no lançamento. Dois palpites,
// nesta ordem:
//   1. histórico: a última vez que alguém do grupo lançou algo com descrição
//      parecida ("Mercado" -> "mercado extra"), usa a mesma categoria. É o
//      palpite que aprende com o jeito do casal.
//   2. palavra-chave: "uber", "ifood", "farmácia"... -> a categoria padrão
//      que combina (ou uma do grupo com o mesmo nome).
// Sem palpite bom, não sugere nada -- melhor do que sugerir errado.
// ============================================================================
import { db } from "../../db/firestore";
import { findVisibleCategories, type CategoryRow, type CategoryType } from "./categories.repository";

export interface CategorySuggestion {
  categoryId: string | null;
  source: "history" | "keyword" | null;
}

const NO_SUGGESTION: CategorySuggestion = { categoryId: null, source: null };

// Quantos lançamentos recentes olhar no histórico (metade da conta conjunta,
// metade da pessoal): o bastante pro que o casal costuma lançar, sem ler o
// extrato inteiro a cada letra digitada.
const HISTORY_PER_QUERY = 150;

// "Supermercado  Extra" e "supermercado extra" são a mesma coisa.
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Igual, ou uma começa com a outra ("mercado" e "mercado extra") -- desde
// que a menor tenha ao menos 3 letras, senão "a" casaria com tudo.
export function isSimilarDescription(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 3 && longer.startsWith(shorter);
}

// Palavra da descrição -> nomes de categoria, do mais específico pro mais
// geral. As padrão do app são Moradia, Alimentação, Transporte, Saúde,
// Lazer, Compras, Contas Fixas, Educação, Outros e Receita (ver
// scripts/seed-emulator.ts); os outros nomes são os que o grupo costuma
// criar ("Mercado", "Restaurante"...) e ganham da padrão quando existem.
const MARKET = ["Mercado", "Supermercado", "Alimentação"];
const FOOD_OUT = ["Restaurante", "Restaurantes", "Delivery", "Alimentação"];
const TRANSPORT = ["Transporte"];
const HEALTH = ["Farmácia", "Saúde"];
const BILLS = ["Contas Fixas", "Contas", "Moradia"];
const HOUSING = ["Moradia", "Contas Fixas"];
const FUN = ["Lazer", "Assinaturas"];

const EXPENSE_KEYWORDS: Record<string, string[]> = {
  mercado: MARKET,
  supermercado: MARKET,
  atacadao: MARKET,
  assai: MARKET,
  carrefour: MARKET,
  ifood: FOOD_OUT,
  lanche: FOOD_OUT,
  restaurante: FOOD_OUT,
  pizza: FOOD_OUT,
  hamburguer: FOOD_OUT,
  padaria: FOOD_OUT,
  uber: TRANSPORT,
  "99": TRANSPORT,
  gasolina: TRANSPORT,
  combustivel: TRANSPORT,
  onibus: TRANSPORT,
  metro: TRANSPORT,
  estacionamento: TRANSPORT,
  farmacia: HEALTH,
  drogasil: HEALTH,
  raia: HEALTH,
  remedio: HEALTH,
  medico: ["Saúde"],
  consulta: ["Saúde"],
  luz: BILLS,
  energia: BILLS,
  agua: BILLS,
  internet: BILLS,
  gas: BILLS,
  aluguel: HOUSING,
  condominio: HOUSING,
  netflix: ["Assinaturas", "Lazer"],
  spotify: ["Assinaturas", "Lazer"],
  cinema: FUN,
  show: FUN,
  bar: FUN,
};

const INCOME_KEYWORDS: Record<string, string[]> = {
  salario: ["Salário", "Receita"],
};

function suggestByKeyword(description: string, type: CategoryType, categories: CategoryRow[]): string | null {
  const keywords = type === "income" ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  const byName = new Map<string, CategoryRow>();
  for (const category of categories) {
    // Se o grupo tem uma com o mesmo nome de uma padrão, a do grupo ganha.
    const key = normalizeText(category.name);
    if (!byName.has(key) || category.groupId !== null) byName.set(key, category);
  }
  // Palavra inteira: "bar" não pode casar com "barbearia".
  for (const word of description.split(/[^a-z0-9]+/)) {
    const names = keywords[word];
    if (!names) continue;
    for (const name of names) {
      const category = byName.get(normalizeText(name));
      if (category) return category.id;
    }
  }
  return null;
}

// Os mais recentes que a pessoa enxerga: conta conjunta (menos os privados
// dos outros) e a própria conta pessoal. Só os campos usados aqui, e as
// consultas usam os índices que o extrato já tem (grupo + conta + data).
async function suggestByHistory(
  groupId: string,
  userId: string,
  description: string,
  type: CategoryType,
  categoryIds: Set<string>
): Promise<string | null> {
  const transactions = db.collection("transactions");
  const fields = ["description", "categoryId", "transactionType", "occurredAt", "isPrivate", "createdBy", "createdAt"];
  const [joint, own] = await Promise.all([
    transactions
      .where("groupId", "==", groupId)
      .where("accountType", "==", "joint")
      .orderBy("occurredAt", "desc")
      .select(...fields)
      .limit(HISTORY_PER_QUERY)
      .get(),
    transactions
      .where("groupId", "==", groupId)
      .where("accountOwnerId", "==", userId)
      .orderBy("occurredAt", "desc")
      .select(...fields)
      .limit(HISTORY_PER_QUERY)
      .get(),
  ]);
  const seen = new Set<string>();
  const rows = [...joint.docs, ...own.docs]
    .filter((doc) => !seen.has(doc.id) && Boolean(seen.add(doc.id)))
    .map((doc) => doc.data())
    .filter((data) => data.isPrivate !== true || data.createdBy === userId)
    .sort((a, b) => {
      const byDate = String(b.occurredAt).localeCompare(String(a.occurredAt));
      if (byDate !== 0) return byDate;
      const aCreated = (a.createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      const bCreated = (b.createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      return bCreated - aCreated;
    });
  for (const data of rows) {
    // Lançamento antigo sem o campo é despesa (mesma regra das categorias).
    const rowType: CategoryType = data.transactionType === "income" ? "income" : "expense";
    if (rowType !== type) continue;
    if (typeof data.categoryId !== "string" || !categoryIds.has(data.categoryId)) continue;
    if (typeof data.description !== "string") continue;
    if (isSimilarDescription(description, normalizeText(data.description))) return data.categoryId;
  }
  return null;
}

export async function suggestCategory(
  groupId: string,
  userId: string,
  rawDescription: string,
  type: CategoryType
): Promise<CategorySuggestion> {
  const description = normalizeText(rawDescription);
  // Uma letra só não diz nada: nem vale ir ao Firestore.
  if (description.replace(/[^a-z0-9]/g, "").length < 2) return NO_SUGGESTION;

  // Só categorias que ainda existem, que o grupo enxerga e do tipo certo --
  // uma apagada ou de receita nunca é sugerida pra um gasto.
  const categories = (await findVisibleCategories(groupId)).filter((category) => category.type === type);
  const fromHistory = await suggestByHistory(groupId, userId, description, type, new Set(categories.map((c) => c.id)));
  if (fromHistory) return { categoryId: fromHistory, source: "history" };

  const fromKeyword = suggestByKeyword(description, type, categories);
  if (fromKeyword) return { categoryId: fromKeyword, source: "keyword" };

  return NO_SUGGESTION;
}
