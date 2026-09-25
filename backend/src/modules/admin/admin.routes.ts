import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  blockUserHandler,
  getAdminOverviewHandler,
  getDiagnosticsHandler,
  getUserHandler,
  insightsHandler,
  listUsersHandler,
  testAiHandler,
  testEmailHandler,
  updateSettingsHandler,
} from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.get("/overview", asyncHandler(getAdminOverviewHandler));
adminRouter.get("/diagnostics", asyncHandler(getDiagnosticsHandler));
adminRouter.post("/test-email", asyncHandler(testEmailHandler));
adminRouter.post("/test-ai", asyncHandler(testAiHandler));
adminRouter.get("/insights", asyncHandler(insightsHandler));
adminRouter.post("/settings", asyncHandler(updateSettingsHandler));
adminRouter.get("/users", asyncHandler(listUsersHandler));
adminRouter.get("/users/:userId", asyncHandler(getUserHandler));
adminRouter.post("/users/:userId/block", asyncHandler(blockUserHandler));
