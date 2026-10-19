// ============================================================================
// MÓDULO goals -- endereços /api/goals
// ============================================================================
// O que faz: Metas: criar, guardar e retirar dinheiro (tirando da conta ou
//            não), histórico, submetas, apagar.
// Quem chama: Tela Metas (pages/GoalsPage.tsx), widget de meta no Painel e
//             importar extrato (guardar numa meta).
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
  addGoalItemHandler,
  contributeToGoalHandler,
  createGoalHandler,
  deleteGoalHandler,
  listContributionsHandler,
  listGoalsHandler,
  moveGoalMoneyHandler,
  removeGoalItemHandler,
  updateGoalItemHandler,
} from "./goals.controller";

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.post("/", asyncHandler(createGoalHandler));
goalsRouter.get("/", asyncHandler(listGoalsHandler));
goalsRouter.post("/:id/contribute", asyncHandler(contributeToGoalHandler));
goalsRouter.post("/:id/money", asyncHandler(moveGoalMoneyHandler));
goalsRouter.get("/:id/contributions", asyncHandler(listContributionsHandler));
goalsRouter.post("/:id/items", asyncHandler(addGoalItemHandler));
goalsRouter.patch("/:id/items/:itemId", asyncHandler(updateGoalItemHandler));
goalsRouter.delete("/:id/items/:itemId", asyncHandler(removeGoalItemHandler));
goalsRouter.delete("/:id", asyncHandler(deleteGoalHandler));
