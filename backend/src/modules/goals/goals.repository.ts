import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";

// Submeta ("PC gamer" -> Placa de vídeo, Placa-mãe, Processador), cada uma
// com o preço. Com submetas, o alvo e o guardado da meta são sempre a soma
// delas.
export interface GoalItemRow {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  isDone: boolean;
}

export interface GoalRow {
  id: string;
  groupId: string;
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  achievedAt: string | null;
  items: GoalItemRow[];
}

export const MAX_GOAL_ITEMS = 12;

export interface StoredGoalItem {
  id: string;
  name: string;
  targetCents: number;
  currentCents: number;
}

const goalsCol = db.collection("goals");

export function goalRef(goalId: string): FirebaseFirestore.DocumentReference {
  return goalsCol.doc(goalId);
}

export function storedItems(data: FirebaseFirestore.DocumentData): StoredGoalItem[] {
  return Array.isArray(data.items) ? (data.items as StoredGoalItem[]) : [];
}

export function toGoalRow(doc: FirebaseFirestore.DocumentSnapshot): GoalRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    name: data.name,
    emoji: data.emoji ?? null,
    photoDataUrl: data.photoDataUrl ?? null,
    targetAmount: fromCents(data.targetAmountCents),
    currentAmount: fromCents(data.currentAmountCents),
    deadline: data.deadline ?? null,
    achievedAt: data.achievedAt ? data.achievedAt.toDate().toISOString() : null,
    items: storedItems(data).map((item) => ({
      id: item.id,
      name: item.name,
      targetAmount: fromCents(item.targetCents),
      currentAmount: fromCents(item.currentCents),
      isDone: item.currentCents >= item.targetCents,
    })),
  };
}

// Campos de total a gravar junto com as submetas (ou com o guardado, quando
// não tem submeta). Concluída quando o guardado alcança o alvo; volta a
// aberta se o alvo subir ou alguém retirar.
export function goalTotals(
  data: FirebaseFirestore.DocumentData,
  items: StoredGoalItem[],
  plain?: { targetCents: number; currentCents: number }
): Record<string, unknown> {
  const targetCents = items.length > 0 ? items.reduce((sum, item) => sum + item.targetCents, 0) : plain!.targetCents;
  const currentCents = items.length > 0 ? items.reduce((sum, item) => sum + item.currentCents, 0) : plain!.currentCents;
  const reached = targetCents > 0 && currentCents >= targetCents;
  return {
    targetAmountCents: targetCents,
    currentAmountCents: currentCents,
    achievedAt: reached ? data.achievedAt ?? FieldValue.serverTimestamp() : null,
    isAchieved: reached,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export function newGoalItem(name: string, targetAmount: number): StoredGoalItem {
  return { id: randomUUID(), name, targetCents: toCents(targetAmount), currentCents: 0 };
}

export async function insertGoal(input: {
  groupId: string;
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: number;
  deadline: string | null;
  items?: { name: string; targetAmount: number }[];
}): Promise<GoalRow> {
  const items = (input.items ?? []).map((item) => newGoalItem(item.name, item.targetAmount));
  const targetCents = items.length > 0 ? items.reduce((sum, item) => sum + item.targetCents, 0) : toCents(input.targetAmount);
  const ref = await goalsCol.add({
    groupId: input.groupId,
    name: input.name,
    emoji: input.emoji,
    photoDataUrl: input.photoDataUrl,
    targetAmountCents: targetCents,
    currentAmountCents: 0,
    deadline: input.deadline,
    achievedAt: null,
    isAchieved: false,
    items,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toGoalRow(doc);
}

export async function findGoalsByGroupId(groupId: string): Promise<GoalRow[]> {
  const snapshot = await goalsCol
    .where("groupId", "==", groupId)
    .orderBy("isAchieved", "asc")
    .orderBy("createdAt", "desc")
    .get();
  return snapshot.docs.map(toGoalRow);
}

export async function findGoalById(goalId: string): Promise<GoalRow | null> {
  const doc = await goalsCol.doc(goalId).get();
  if (!doc.exists) return null;
  return toGoalRow(doc);
}

export async function deleteGoal(goalId: string): Promise<void> {
  const contributions = await goalsCol.doc(goalId).collection("contributions").get();
  const batch = db.batch();
  contributions.docs.slice(0, 450).forEach((doc) => batch.delete(doc.ref));
  batch.delete(goalsCol.doc(goalId));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Histórico: quem guardou ou retirou, quanto, quando e em qual submeta.
// ---------------------------------------------------------------------------

export interface GoalContributionRow {
  id: string;
  userId: string;
  amount: string; // positivo = guardou, negativo = retirou
  itemId: string | null;
  itemName: string | null;
  accountId: string | null;
  transactionId: string | null;
  createdAt: number;
}

export function contributionRef(goalId: string): FirebaseFirestore.DocumentReference {
  return goalsCol.doc(goalId).collection("contributions").doc();
}

export async function findContributions(goalId: string, limit = 30): Promise<GoalContributionRow[]> {
  const snapshot = await goalsCol.doc(goalId).collection("contributions").orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      userId: data.userId,
      amount: fromCents(data.amountCents),
      itemId: data.itemId ?? null,
      itemName: data.itemName ?? null,
      accountId: data.accountId ?? null,
      transactionId: data.transactionId ?? null,
      createdAt: data.createdAt ?? 0,
    };
  });
}
