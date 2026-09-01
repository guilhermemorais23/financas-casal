import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  chatHandler,
  createTelegramLinkCodeHandler,
  greetingHandler,
  telegramWebhookHandler,
  whatsappWebhookHandler,
  whatsappWebhookVerifyHandler,
} from "./assistant.controller";

export const assistantRouter = Router();

// Public (validated by TELEGRAM_WEBHOOK_SECRET inside the handler, not by
// requireAuth -- Telegram has no Firebase user to authenticate as).
assistantRouter.post("/telegram/webhook", asyncHandler(telegramWebhookHandler));

// Same idea for WhatsApp -- GET is Meta's one-time verify handshake (see
// whatsappWebhookVerifyHandler), POST is where actual messages arrive.
assistantRouter.get("/whatsapp/webhook", whatsappWebhookVerifyHandler);
assistantRouter.post("/whatsapp/webhook", asyncHandler(whatsappWebhookHandler));

assistantRouter.post("/telegram/link-code", requireAuth, asyncHandler(createTelegramLinkCodeHandler));
assistantRouter.post("/chat", requireAuth, asyncHandler(chatHandler));
assistantRouter.get("/greeting", requireAuth, asyncHandler(greetingHandler));
