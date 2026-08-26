import { requireGroupId } from "../groups/groups.service";
import {
  addToGoalAmount,
  deleteGoal,
  findGoalById,
  findGoalsByGroupId,
  insertGoal,
} from "./goals.repository";

export class GoalNotFoundError extends Error {}
export class InvalidContributionError extends Error {}

export interface CreateGoalInput {
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: number;
  deadline: string | null;
}

export async function createGoal(userId: string, input: CreateGoalInput) {
  const groupId = await requireGroupId(userId);
  return insertGoal({
    groupId,
    name: input.name,
    emoji: input.emoji,
    photoDataUrl: input.photoDataUrl,
    targetAmount: input.targetAmount,
    deadline: input.deadline,
  });
}

export async function listGoals(userId: string) {
  const groupId = await requireGroupId(userId);
  return findGoalsByGroupId(groupId);
}

async function requireGoalInGroup(userId: string, goalId: string) {
  const groupId = await requireGroupId(userId);
  const goal = await findGoalById(goalId);
  if (!goal || goal.groupId !== groupId) {
    throw new GoalNotFoundError();
  }
  return goal;
}

export async function contributeToGoal(userId: string, goalId: string, amount: number) {
  if (amount <= 0) {
    throw new InvalidContributionError();
  }
  await requireGoalInGroup(userId, goalId);
  return addToGoalAmount(goalId, amount);
}

export async function removeGoal(userId: string, goalId: string) {
  await requireGoalInGroup(userId, goalId);
  await deleteGoal(goalId);
}
