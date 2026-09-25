import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  adminGrantHandler,
  adminOverviewHandler,
  adminRevokeHandler,
  cancelHandler,
  checkoutHandler,
  getBillingHandler,
  webhookHandler,
} from "./billing.controller";

export const billingRouter = Router();
billingRouter.post("/webhook", asyncHandler(webhookHandler));
billingRouter.get("/", requireAuth, asyncHandler(getBillingHandler));
billingRouter.post("/checkout", requireAuth, asyncHandler(checkoutHandler));
billingRouter.post("/cancel", requireAuth, asyncHandler(cancelHandler));
// Admin (conferido contra ADMIN_EMAILS)
billingRouter.get("/admin", requireAuth, asyncHandler(adminOverviewHandler));
billingRouter.post("/admin/courtesy", requireAuth, asyncHandler(adminGrantHandler));
billingRouter.post("/admin/courtesy/revoke", requireAuth, asyncHandler(adminRevokeHandler));
