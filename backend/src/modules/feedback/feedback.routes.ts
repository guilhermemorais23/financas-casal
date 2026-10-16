// ============================================================================
// MÓDULO feedback -- endereços /api/feedback
// ============================================================================
// O que faz: Conversa de feedback em formato de chat entre a pessoa e o dono
//            do app.
// Quem chama: components/FeedbackChat.tsx (quem manda) e Admin > Feedback
//             (quem responde).
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
