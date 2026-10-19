// ============================================================================
// MÓDULO admin -- endereços /api/admin
// ============================================================================
// O que faz: Painel do dono do app: visão geral, usuários (bloquear, redefinir
//            senha, excluir a pedido), diagnóstico das configurações, números
//            de uso da IA e das importações, modo manutenção.
// Quem chama: Tela Admin (pages/AdminPage.tsx e AdminSections.tsx). Só quem
//             está em ADMIN_EMAILS entra -- o adminGuard confere em toda rota.
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
import { isAdminEmail } from "./admin.service";
import {
  blockUserHandler,
  deleteUserHandler,
  passwordResetHandler,
  getAdminOverviewHandler,
  getDiagnosticsHandler,
  getUserHandler,
  importStatsHandler,
  insightsHandler,
  listUsersHandler,
  testAiHandler,
  testEmailHandler,
  updateSettingsHandler,
} from "./admin.controller";

export const adminRouter = Router();

adminRouter.use(requireAuth);
// Trava do roteador inteiro (além da checagem em cada rota): rota nova que
// esquecer a checagem continua fechada pra quem não é admin.
adminRouter.use((req, res, next) => {
  if (!isAdminEmail(req.user?.email ?? "")) {
    res.status(403).json({ error: "not an admin" });
    return;
  }
  next();
});
adminRouter.get("/overview", asyncHandler(getAdminOverviewHandler));
adminRouter.get("/diagnostics", asyncHandler(getDiagnosticsHandler));
adminRouter.post("/test-email", asyncHandler(testEmailHandler));
adminRouter.post("/test-ai", asyncHandler(testAiHandler));
adminRouter.get("/insights", asyncHandler(insightsHandler));
adminRouter.get("/imports", asyncHandler(importStatsHandler));
adminRouter.post("/settings", asyncHandler(updateSettingsHandler));
adminRouter.get("/users", asyncHandler(listUsersHandler));
adminRouter.get("/users/:userId", asyncHandler(getUserHandler));
adminRouter.post("/users/:userId/block", asyncHandler(blockUserHandler));
adminRouter.post("/users/:userId/password-reset", asyncHandler(passwordResetHandler));
adminRouter.post("/users/:userId/delete", asyncHandler(deleteUserHandler));
