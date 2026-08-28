import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  getCategoryBudgetsHandler,
  getCurrentBudgetHandler,
  setCategoryBudgetHandler,
  setCurrentBudgetHandler,
} from "./budgets.controller";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get("/current", asyncHandler(getCurrentBudgetHandler));
budgetsRouter.put("/current", asyncHandler(setCurrentBudgetHandler));
budgetsRouter.get("/categories", asyncHandler(getCategoryBudgetsHandler));
budgetsRouter.put("/categories/:categoryId", asyncHandler(setCategoryBudgetHandler));
