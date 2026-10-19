// ============================================================================
// MÓDULO debts -- endereços /api/debts
// ============================================================================
// O que faz: Dívidas: compras parceladas (N parcelas) e a conta "só esta vez"
//            (1 parcela). Pagar uma parcela cria o gasto no extrato; desmarcar
//            apaga.
// Quem chama: A pagar -> Parceladas (DebtsPage), A pagar -> Contas (seção Só
//             esta vez, RecurringBillsPage) e Contas -> Todas.
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
  createDebtHandler,
  deleteDebtHandler,
  listDebtsHandler,
  setInstallmentPaidHandler,
  updateDebtHandler,
} from "./debts.controller";

export const debtsRouter = Router();

debtsRouter.use(requireAuth);

debtsRouter.post("/", asyncHandler(createDebtHandler));
debtsRouter.get("/", asyncHandler(listDebtsHandler));
debtsRouter.patch("/:debtId/installments/:installmentId", asyncHandler(setInstallmentPaidHandler));
debtsRouter.patch("/:id", asyncHandler(updateDebtHandler));
debtsRouter.delete("/:id", asyncHandler(deleteDebtHandler));
