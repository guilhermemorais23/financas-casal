// ============================================================================
// MÓDULO billing -- endereços /api/billing
// ============================================================================
// O que faz: Assinatura Premium pelo Asaas: situação do plano, pagar,
//            cancelar, cortesia dada pelo Admin, e o webhook do Asaas avisando
//            pagamento.
// Quem chama: Tela Plano (pages/PlanPage.tsx, /plano) e Admin > Assinaturas.
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
  adminGrantHandler,
  adminOverviewHandler,
  adminRevokeHandler,
  cancelHandler,
  checkoutHandler,
  getBillingHandler,
  webhookHandler,
} from "./billing.controller";

export const billingRouter = Router();
billingRouter.post("/webhook", asyncHandler(webhookHandler));
billingRouter.get("/", requireAuth, asyncHandler(getBillingHandler));
billingRouter.post("/checkout", requireAuth, asyncHandler(checkoutHandler));
billingRouter.post("/cancel", requireAuth, asyncHandler(cancelHandler));
// Admin (conferido contra ADMIN_EMAILS)
billingRouter.get("/admin", requireAuth, asyncHandler(adminOverviewHandler));
billingRouter.post("/admin/courtesy", requireAuth, asyncHandler(adminGrantHandler));
billingRouter.post("/admin/courtesy/revoke", requireAuth, asyncHandler(adminRevokeHandler));
