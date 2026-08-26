import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";

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
}

const goalsCol = db.collection("goals");

function toGoalRow(doc: FirebaseFirestore.DocumentSnapshot): GoalRow {
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
  };
}

export async function insertGoal(input: {
  groupId: string;
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: number;
  deadline: string | null;
}): Promise<GoalRow> {
  const ref = await goalsCol.add({
    groupId: input.groupId,
    name: input.name,
    emoji: input.emoji,
    photoDataUrl: input.photoDataUrl,
    targetAmountCents: toCents(input.targetAmount),
    currentAmountCents: 0,
    deadline: input.deadline,
    achievedAt: null,
    isAchieved: false,
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

export async function addToGoalAmount(goalId: string, amount: number): Promise<GoalRow> {
  const ref = goalsCol.doc(goalId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const data = doc.data()!;
    const nextAmount = data.currentAmountCents + toCents(amount);
    const nowAchieved = data.achievedAt === null && nextAmount >= data.targetAmountCents;
    tx.update(ref, {
      currentAmountCents: nextAmount,
      achievedAt: nowAchieved ? FieldValue.serverTimestamp() : (data.achievedAt ?? null),
      isAchieved: data.isAchieved || nowAchieved,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  const doc = await ref.get();
  return toGoalRow(doc);
}

export async function deleteGoal(goalId: string): Promise<void> {
  await goalsCol.doc(goalId).delete();
}
