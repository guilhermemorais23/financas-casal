import { requireCoupleId } from "../couples/couples.service";
import {
  addToGoalAmount,
  deleteGoal,
  findGoalById,
  findGoalsByCoupleId,
  insertGoal,
} from "./goals.repository";

export class GoalNotFoundError extends Error {}
export class InvalidContributionError extends Error {}

export interface CreateGoalInput {
  name: string;
  emoji: string | null;
  targetAmount: number;
  deadline: string | null;
}

export async function createGoal(userId: string, input: CreateGoalInput) {
  const coupleId = await requireCoupleId(userId);
  return insertGoal({
    coupleId,
    name: input.name,
    emoji: input.emoji,
    targetAmount: input.targetAmount,
    deadline: input.deadline,
  });
}

export async function listGoals(userId: string) {
  const coupleId = await requireCoupleId(userId);
  return findGoalsByCoupleId(coupleId);
}

async function requireGoalInCouple(userId: string, goalId: string) {
  const coupleId = await requireCoupleId(userId);
  const goal = await findGoalById(goalId);
  if (!goal || goal.couple_id !== coupleId) {
    throw new GoalNotFoundError();
  }
  return goal;
}

export async function contributeToGoal(userId: string, goalId: string, amount: number) {
  if (amount <= 0) {
    throw new InvalidContributionError();
  }
  await requireGoalInCouple(userId, goalId);
  return addToGoalAmount(goalId, amount);
}

export async function removeGoal(userId: string, goalId: string) {
  await requireGoalInCouple(userId, goalId);
  await deleteGoal(goalId);
}
