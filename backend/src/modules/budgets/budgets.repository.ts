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

// Deterministic doc ID gives true create-time uniqueness (via .create()),
// unlike the old SQL UNIQUE(couple_id, period_month, category_id) which
// didn't actually dedupe NULL category_id rows in Postgres.
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

// Deterministic doc gets in parallel, one per category -- avoids a Firestore
// composite-index requirement that a `.where(groupId).where(periodMonth)`
// query would need, and a group's category count is small enough that N
// parallel .get()s cost nothing.
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
    .select("amountCents")
    .get();
  const totalCents = snapshot.docs.reduce((sum, doc) => sum + doc.data().amountCents, 0);
  return totalCents / 100;
}
