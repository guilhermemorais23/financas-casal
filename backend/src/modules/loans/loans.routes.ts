// ============================================================================
// MÓDULO loans -- endereços /api/loans
// ============================================================================
// O que faz: Empréstimos: "A receber" (emprestei) e "Eu devo" (peguei), com
//            pagamentos parciais.
// Quem chama: Tela Empréstimos (pages/LoansPage.tsx).
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
  addRepaymentHandler,
  createLoanHandler,
  deleteLoanHandler,
  listLoansHandler,
  removeRepaymentHandler,
  updateLoanHandler,
} from "./loans.controller";

export const loansRouter = Router();
loansRouter.use(requireAuth);
loansRouter.get("/", asyncHandler(listLoansHandler));
loansRouter.post("/", asyncHandler(createLoanHandler));
loansRouter.patch("/:id", asyncHandler(updateLoanHandler));
loansRouter.delete("/:id", asyncHandler(deleteLoanHandler));
loansRouter.post("/:id/repayments", asyncHandler(addRepaymentHandler));
loansRouter.delete("/:id/repayments/:repaymentId", asyncHandler(removeRepaymentHandler));
