// ============================================================================
// MÓDULO announcements -- endereços /api/announcements
// ============================================================================
// O que faz: Novidades: os pop-ups que o dono manda pelo Admin, pra todo mundo
//            ou pra uma pessoa, e o "já vi" de cada um.
// Quem chama: components/AnnouncementPopup.tsx (quem recebe) e Admin >
//             Novidades (quem envia).
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
  createHandler,
  listForAdminHandler,
  listPendingHandler,
  listPeopleHandler,
  markSeenHandler,
  setActiveHandler,
} from "./announcements.controller";

// Pop-ups de novidade/aviso que o admin manda pra todo mundo ou pra uma pessoa.
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);
announcementsRouter.get("/pending", asyncHandler(listPendingHandler));
announcementsRouter.post("/:id/seen", asyncHandler(markSeenHandler));
// Admin
announcementsRouter.get("/", asyncHandler(listForAdminHandler));
announcementsRouter.get("/people", asyncHandler(listPeopleHandler));
announcementsRouter.post("/", asyncHandler(createHandler));
announcementsRouter.patch("/:id", asyncHandler(setActiveHandler));
