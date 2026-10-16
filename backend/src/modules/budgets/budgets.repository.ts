import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";

export interface BudgetRow {
  id: string;
  groupId: string;
  periodMonth: string;
  capAmount: string;
  categoryId: string | null;
}

const budgetsCol = db.collection("budgets");

// ID do documento fixo (calculado) garante que não existe duplicado na
// criação (via .create()), diferente do antigo UNIQUE(couple_id,
// period_month, category_id) do SQL, que não evitava linhas repetidas com
// category_id NULL no Postgres.
function budgetDocId(groupId: string, periodMonth: string, categoryId: string | null): string {
  return `${groupId}_${periodMonth}_${categoryId ?? "none"}`;
}

function toBudgetRow(doc: FirebaseFirestore.DocumentSnapshot): BudgetRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    periodMonth: data.periodMonth,
    capAmount: fromCents(data.capAmountCents),
    categoryId: data.categoryId ?? null,
  };
}

export async function findGroupBudget(groupId: string, periodMonth: string): Promise<BudgetRow | null> {
  const doc = await budgetsCol.doc(budgetDocId(groupId, periodMonth, null)).get();
  if (!doc.exists) return null;
  return toBudgetRow(doc);
}

export async function upsertGroupBudget(input: {
  groupId: string;
  periodMonth: string;
  capAmount: number;
}): Promise<BudgetRow> {
  const ref = budgetsCol.doc(budgetDocId(input.groupId, input.periodMonth, null));
  const existing = await ref.get();
  await ref.set(
    {
      groupId: input.groupId,
      periodMonth: input.periodMonth,
      capAmountCents: toCents(input.capAmount),
      categoryId: null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
  const doc = await ref.get();
  return toBudgetRow(doc);
}

// Busca os documentos de ID fixo em paralelo, um por categoria -- evita o
// índice composto que uma consulta `.where(groupId).where(periodMonth)`
// exigiria no Firestore, e um grupo tem poucas categorias, então N .get() em
// paralelo não custam nada.
export async function findCategoryBudgets(
  groupId: string,
  periodMonth: string,
  categoryIds: string[]
): Promise<Map<string, BudgetRow>> {
  const docs = await Promise.all(
    categoryIds.map((categoryId) => budgetsCol.doc(budgetDocId(groupId, periodMonth, categoryId)).get())
  );
  const result = new Map<string, BudgetRow>();
  docs.forEach((doc, index) => {
    if (doc.exists) result.set(categoryIds[index], toBudgetRow(doc));
  });
  return result;
}

export async function upsertCategoryBudget(input: {
  groupId: string;
  periodMonth: string;
  categoryId: string;
  capAmount: number;
}): Promise<BudgetRow> {
  const ref = budgetsCol.doc(budgetDocId(input.groupId, input.periodMonth, input.categoryId));
  const existing = await ref.get();
  await ref.set(
    {
      groupId: input.groupId,
      periodMonth: input.periodMonth,
      capAmountCents: toCents(input.capAmount),
      categoryId: input.categoryId,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    },
    { merge: true }
  );
  const doc = await ref.get();
  return toBudgetRow(doc);
}

export async function deleteCategoryBudget(
  groupId: string,
  periodMonth: string,
  categoryId: string
): Promise<void> {
  await budgetsCol.doc(budgetDocId(groupId, periodMonth, categoryId)).delete();
}

export async function getMonthlyExpenseTotal(
  groupId: string,
  monthStart: string,
  monthEnd: string
): Promise<number> {
  const snapshot = await db
    .collection("transactions")
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint")
    .where("transactionType", "==", "expense")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd)
    .select("amountCents", "securedCardId", "loanId", "transferKind")
    .get();
  // Dinheiro guardado no cartão com limite garantido ou emprestado pra alguém
  // não é gasto.
  const totalCents = snapshot.docs.reduce(
    (sum, doc) => (doc.data().securedCardId || doc.data().loanId || doc.data().transferKind ? sum : sum + doc.data().amountCents),
    0
  );
  return totalCents / 100;
}
