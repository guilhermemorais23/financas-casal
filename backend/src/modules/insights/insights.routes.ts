import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getInsightHandler } from "./insights.controller";

export const insightsRouter = Router();

insightsRouter.use(requireAuth);
insightsRouter.get("/", asyncHandler(getInsightHandler));
