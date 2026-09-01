import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getDashboardHandler } from "./dashboard.controller";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/", asyncHandler(getDashboardHandler));
