import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { listAlertsHandler } from "./alerts.controller";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get("/", asyncHandler(listAlertsHandler));
