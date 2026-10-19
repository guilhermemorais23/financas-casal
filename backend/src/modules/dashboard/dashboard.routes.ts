// ============================================================================
// MÓDULO dashboard -- endereços /api/dashboard
// ============================================================================
// O que faz: Tudo que o Painel precisa numa chamada só: saldo do mês, entrada
//            e saída, o que vence em 7 dias, alertas, meta em destaque,
//            próxima fatura, tendência.
// Quem chama: pages/DashboardPage.tsx (Painel).
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
import { getDashboardHandler } from "./dashboard.controller";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);
dashboardRouter.get("/", asyncHandler(getDashboardHandler));
