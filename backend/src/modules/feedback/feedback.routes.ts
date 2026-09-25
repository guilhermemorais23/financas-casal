import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createFeedbackHandler,
  getMyConversationHandler,
  getMyUnreadHandler,
  getThreadHandler,
  listThreadsHandler,
  replyHandler,
} from "./feedback.controller";

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);
feedbackRouter.get("/", asyncHandler(getMyConversationHandler));
feedbackRouter.get("/unread", asyncHandler(getMyUnreadHandler));
feedbackRouter.post("/", asyncHandler(createFeedbackHandler));
// Lado do admin (o dono respondendo) -- conferido contra ADMIN_EMAILS.
feedbackRouter.get("/threads", asyncHandler(listThreadsHandler));
feedbackRouter.get("/threads/:threadId", asyncHandler(getThreadHandler));
feedbackRouter.post("/threads/:threadId/reply", asyncHandler(replyHandler));
