// ============================================================================
// MÓDULO budgets -- endereços /api/budgets
// ============================================================================
// O que faz: Orçamento: teto de gasto do mês, geral e por categoria, já com
//            quanto foi gasto.
// Quem chama: Tela Conta (definir teto), Par e o menu lateral (AppLayout).
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
  getCategoryBudgetsHandler,
  getCurrentBudgetHandler,
  setCategoryBudgetHandler,
  setCurrentBudgetHandler,
} from "./budgets.controller";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

budgetsRouter.get("/current", asyncHandler(getCurrentBudgetHandler));
budgetsRouter.put("/current", asyncHandler(setCurrentBudgetHandler));
budgetsRouter.get("/categories", asyncHandler(getCategoryBudgetsHandler));
budgetsRouter.put("/categories/:categoryId", asyncHandler(setCategoryBudgetHandler));
