// ============================================================================
// MÓDULO alerts -- endereços /api/alerts
// ============================================================================
// O que faz: Alertas inteligentes: ritmo do orçamento (vai estourar?), picos
//            de gasto por categoria e vencimentos chegando.
// Quem chama: O Painel recebe estes alertas dentro de /api/dashboard
//             (dashboard.service.ts). Esta rota própria existe, mas o app de
//             hoje não chama ela.
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
import { listAlertsHandler } from "./alerts.controller";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get("/", asyncHandler(listAlertsHandler));
