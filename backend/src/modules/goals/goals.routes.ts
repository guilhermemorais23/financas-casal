import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  addGoalItemHandler,
  contributeToGoalHandler,
  createGoalHandler,
  deleteGoalHandler,
  listContributionsHandler,
  listGoalsHandler,
  moveGoalMoneyHandler,
  removeGoalItemHandler,
  updateGoalItemHandler,
} from "./goals.controller";

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.post("/", asyncHandler(createGoalHandler));
goalsRouter.get("/", asyncHandler(listGoalsHandler));
goalsRouter.post("/:id/contribute", asyncHandler(contributeToGoalHandler));
goalsRouter.post("/:id/money", asyncHandler(moveGoalMoneyHandler));
goalsRouter.get("/:id/contributions", asyncHandler(listContributionsHandler));
goalsRouter.post("/:id/items", asyncHandler(addGoalItemHandler));
goalsRouter.patch("/:id/items/:itemId", asyncHandler(updateGoalItemHandler));
goalsRouter.delete("/:id/items/:itemId", asyncHandler(removeGoalItemHandler));
goalsRouter.delete("/:id", asyncHandler(deleteGoalHandler));
