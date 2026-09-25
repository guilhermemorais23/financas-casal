import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getMonthCloseHandler } from "./monthClose.controller";

export const monthCloseRouter = Router();

monthCloseRouter.use(requireAuth);

// GET /api/month-close?month=YYYY-MM (sem month = mês passado)
monthCloseRouter.get("/", asyncHandler(getMonthCloseHandler));
