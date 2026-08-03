import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  contributeToGoalHandler,
  createGoalHandler,
  deleteGoalHandler,
  listGoalsHandler,
} from "./goals.controller";

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.post("/", asyncHandler(createGoalHandler));
goalsRouter.get("/", asyncHandler(listGoalsHandler));
goalsRouter.post("/:id/contribute", asyncHandler(contributeToGoalHandler));
goalsRouter.delete("/:id", asyncHandler(deleteGoalHandler));
