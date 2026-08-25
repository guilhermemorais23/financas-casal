import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { chatHandler, createTelegramLinkCodeHandler, telegramWebhookHandler } from "./assistant.controller";

export const assistantRouter = Router();

// Public (validated by TELEGRAM_WEBHOOK_SECRET inside the handler, not by
// requireAuth -- Telegram has no Firebase user to authenticate as).
assistantRouter.post("/telegram/webhook", asyncHandler(telegramWebhookHandler));

assistantRouter.post("/telegram/link-code", requireAuth, asyncHandler(createTelegramLinkCodeHandler));
assistantRouter.post("/chat", requireAuth, asyncHandler(chatHandler));
