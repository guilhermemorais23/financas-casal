// ============================================================================
// MÓDULO assistant -- endereços /api/assistant
// ============================================================================
// O que faz: Assistente com IA (Gemini): chat dentro do app, e o mesmo
//            assistente pelo Telegram e pelo WhatsApp (webhooks sem login,
//            conferidos por segredo). Também gera o código de vincular essas
//            contas.
// Quem chama: components/GlobalAssistant.tsx (chat) e a tela Conta (vincular
//             Telegram/WhatsApp).
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
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

// Público (conferido pelo TELEGRAM_WEBHOOK_SECRET dentro da função, não pelo
// requireAuth -- o Telegram não tem usuário do Firebase pra se identificar).
assistantRouter.post("/telegram/webhook", asyncHandler(telegramWebhookHandler));

// Mesma ideia pro WhatsApp -- o GET é o aperto de mão único da Meta (ver
// whatsappWebhookVerifyHandler), o POST é por onde chegam as mensagens.
assistantRouter.get("/whatsapp/webhook", whatsappWebhookVerifyHandler);
assistantRouter.post("/whatsapp/webhook", asyncHandler(whatsappWebhookHandler));

assistantRouter.post("/telegram/link-code", requireAuth, asyncHandler(createTelegramLinkCodeHandler));
assistantRouter.post("/chat", requireAuth, asyncHandler(chatHandler));
assistantRouter.get("/greeting", requireAuth, asyncHandler(greetingHandler));
