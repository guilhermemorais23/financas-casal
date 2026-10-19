// ============================================================================
// MÓDULO quotes -- endereços /api/quotes
// ============================================================================
// O que faz: Cotações (brapi): histórico do Ibovespa e de algumas ações, e a
//            cotação de um papel.
// Quem chama: Tela Investimentos (pages/InvestmentsPage.tsx).
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
import { getQuotesHandler, getStockQuoteHandler } from "./quotes.controller";

export const quotesRouter = Router();

quotesRouter.use(requireAuth);
quotesRouter.get("/", asyncHandler(getQuotesHandler));
quotesRouter.get("/stock", asyncHandler(getStockQuoteHandler));
