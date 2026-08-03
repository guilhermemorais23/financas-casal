import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getCurrentBudgetHandler, setCurrentBudgetHandler } from "./budgets.controller";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get("/current", asyncHandler(getCurrentBudgetHandler));
budgetsRouter.put("/current", asyncHandler(setCurrentBudgetHandler));
