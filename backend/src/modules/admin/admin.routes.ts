import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getAdminOverviewHandler, getDiagnosticsHandler, testAiHandler, testEmailHandler } from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.get("/overview", asyncHandler(getAdminOverviewHandler));
adminRouter.get("/diagnostics", asyncHandler(getDiagnosticsHandler));
adminRouter.post("/test-email", asyncHandler(testEmailHandler));
adminRouter.post("/test-ai", asyncHandler(testAiHandler));
