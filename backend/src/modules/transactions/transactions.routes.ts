// ============================================================================
// MÓDULO transactions -- endereços /api/transactions
// ============================================================================
// O que faz: Lançamentos (gastos e receitas): criar, listar, editar, apagar,
//            apagar vários, séries recorrentes, divisão entre o grupo e acerto
//            ("pago"), saldo de quem deve quem, resumos do mês e do ano, série
//            diária, organizar sem categoria e sem forma de pagamento,
//            exportar CSV.
// Quem chama: Quase todas as telas: Painel, Par, Relatórios, Nova despesa,
//             edição de lançamento.
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
import { requirePremium } from "../../middleware/requirePremium";
import {
  cancelRecurringHandler,
  createTransactionHandler,
  deleteTransactionHandler,
  bulkDeleteHandler,
  exportTransactionsHandler,
  getBalanceHandler,
  getDailySeriesHandler,
  getSummaryHandler,
  getYearlySummaryHandler,
  listTransactionsHandler,
  setSplitSettledHandler,
  updateRecurringHandler,
  updateTransactionHandler,
} from "./transactions.controller";
import { categorizeHandler, listUncategorizedHandler, listNoPaymentHandler, setPaymentMethodsHandler } from "./uncategorized.controller";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.post("/", asyncHandler(createTransactionHandler));
transactionsRouter.get("/", asyncHandler(listTransactionsHandler));
transactionsRouter.get("/balance", asyncHandler(getBalanceHandler));
transactionsRouter.get("/summary", asyncHandler(getSummaryHandler));
transactionsRouter.get("/summary/year", asyncHandler(getYearlySummaryHandler));
transactionsRouter.get("/daily-series", asyncHandler(getDailySeriesHandler));
transactionsRouter.get("/uncategorized", asyncHandler(listUncategorizedHandler));
transactionsRouter.post("/categorize", asyncHandler(categorizeHandler));
transactionsRouter.get("/no-payment-method", asyncHandler(listNoPaymentHandler));
transactionsRouter.post("/payment-method", asyncHandler(setPaymentMethodsHandler));
// Exportar (CSV) é do Premium.
transactionsRouter.get("/export", requirePremium, asyncHandler(exportTransactionsHandler));
transactionsRouter.patch("/:id/settle", asyncHandler(setSplitSettledHandler));
transactionsRouter.patch("/:id/recurring", asyncHandler(updateRecurringHandler));
transactionsRouter.patch("/:id", asyncHandler(updateTransactionHandler));
transactionsRouter.delete("/:id/recurring", asyncHandler(cancelRecurringHandler));
transactionsRouter.post("/bulk-delete", asyncHandler(bulkDeleteHandler));
transactionsRouter.delete("/:id", asyncHandler(deleteTransactionHandler));
