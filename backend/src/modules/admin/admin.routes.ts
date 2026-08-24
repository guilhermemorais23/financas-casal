import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getAdminOverviewHandler } from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.get("/overview", asyncHandler(getAdminOverviewHandler));
