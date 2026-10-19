// ============================================================================
// MÓDULO groups -- endereços /api/groups
// ============================================================================
// O que faz: Grupos: criar, convidar por link, aceitar convite, sair, remover
//            integrante, nome e foto do grupo, e a lista de grupos de quem
//            participa de vários.
// Quem chama: Configurar grupo (GroupSetupPage), Conta, seletor de grupo
//             (GroupSwitcher) e quase toda tela (GET /groups/me traz contas e
//             membros).
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
  acceptInviteHandler,
  createGroupHandler,
  createInviteHandler,
  getMyGroupHandler,
  leaveGroupHandler,
  listMyGroupsHandler,
  removeMemberHandler,
  updateFinancialProfileHandler,
  updateGroupIdentityHandler,
} from "./groups.controller";

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

groupsRouter.get("/", asyncHandler(listMyGroupsHandler));
groupsRouter.post("/", asyncHandler(createGroupHandler));
groupsRouter.post("/accept", asyncHandler(acceptInviteHandler));
groupsRouter.get("/me", asyncHandler(getMyGroupHandler));
groupsRouter.patch("/me", asyncHandler(updateGroupIdentityHandler));
groupsRouter.post("/invite", asyncHandler(createInviteHandler));
groupsRouter.post("/leave", asyncHandler(leaveGroupHandler));
groupsRouter.delete("/members/:userId", asyncHandler(removeMemberHandler));
groupsRouter.patch("/financial-profile", asyncHandler(updateFinancialProfileHandler));
