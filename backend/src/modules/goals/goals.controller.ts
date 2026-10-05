import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  GoalNotFoundError,
  InvalidContributionError,
  contributeToGoal,
  createGoal,
  listGoals,
  removeGoal,
} from "./goals.service";
import { isNonEmptyString, isValidAmount } from "../../utils/validation";


// Same cap as the profile avatar -- a compressed, client-resized photo
// comfortably clears this regardless of what the original file was.
const MAX_PHOTO_DATA_URL_LENGTH = 300_000;

export async function createGoalHandler(req: Request, res: Response) {
  const { name, emoji, photoDataUrl, targetAmount, deadline } = req.body ?? {};

  if (!isNonEmptyString(name) || !isValidAmount(targetAmount)) {
    res.status(400).json({ error: "name and targetAmount are required" });
    return;
  }

  if (photoDataUrl !== undefined && photoDataUrl !== null) {
    if (typeof photoDataUrl !== "string" || !photoDataUrl.startsWith("data:image/")) {
      res.status(400).json({ error: "photoDataUrl must be a data:image/... URL or null" });
      return;
    }
    if (photoDataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
      res.status(400).json({ error: "photo is too large" });
      return;
    }
  }

  const goal = await createGoal(req.user!.id, {
    name: name.trim(),
    emoji: isNonEmptyString(emoji) ? emoji : null,
    photoDataUrl: photoDataUrl ?? null,
    targetAmount,
    deadline: isNonEmptyString(deadline) ? deadline : null,
  });
  res.status(201).json(goal);
}

export async function listGoalsHandler(req: Request, res: Response) {
  const goals = await listGoals(req.user!.id);
  res.status(200).json(goals);
}

export async function contributeToGoalHandler(req: Request, res: Response) {
  const { amount } = req.body ?? {};
  if (!isValidAmount(amount)) {
    res.status(400).json({ error: "amount is required" });
    return;
  }

  try {
    const goal = await contributeToGoal(req.user!.id, req.params.id, amount);
    res.status(200).json(goal);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof GoalNotFoundError) {
      res.status(404).json({ error: "goal not found" });
      return;
    }
    if (err instanceof InvalidContributionError) {
      res.status(400).json({ error: "amount must be positive" });
      return;
    }
    throw err;
  }
}

export async function deleteGoalHandler(req: Request, res: Response) {
  try {
    await removeGoal(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof GoalNotFoundError) {
      res.status(404).json({ error: "goal not found" });
      return;
    }
    throw err;
  }
}
