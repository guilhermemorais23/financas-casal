import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdminEmail } from "./admin.service";
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
// Trava do roteador inteiro (além da checagem em cada rota): rota nova que
// esquecer a checagem continua fechada pra quem não é admin.
adminRouter.use((req, res, next) => {
  if (!isAdminEmail(req.user?.email ?? "")) {
    res.status(403).json({ error: "not an admin" });
    return;
  }
  next();
});
adminRouter.get("/overview", asyncHandler(getAdminOverviewHandler));
adminRouter.get("/diagnostics", asyncHandler(getDiagnosticsHandler));
adminRouter.post("/test-email", asyncHandler(testEmailHandler));
adminRouter.post("/test-ai", asyncHandler(testAiHandler));
adminRouter.get("/insights", asyncHandler(insightsHandler));
adminRouter.post("/settings", asyncHandler(updateSettingsHandler));
adminRouter.get("/users", asyncHandler(listUsersHandler));
adminRouter.get("/users/:userId", asyncHandler(getUserHandler));
adminRouter.post("/users/:userId/block", asyncHandler(blockUserHandler));
