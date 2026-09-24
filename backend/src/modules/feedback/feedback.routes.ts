import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { createFeedbackHandler } from "./feedback.controller";

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);
feedbackRouter.post("/", asyncHandler(createFeedbackHandler));
