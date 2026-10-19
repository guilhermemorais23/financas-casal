// ============================================================================
// MÓDULO cards -- endereços /api/cards
// ============================================================================
// O que faz: Cartões de crédito: compras (à vista e parceladas), faturas,
//            marcar fatura como paga (vira gasto de verdade), limite, e cartão
//            com limite garantido (guardar e resgatar).
// Quem chama: Tela Cartões (pages/CardsPage.tsx), Nova despesa (compra no
//             cartão) e Contas -> Todas (pagar fatura).
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
  addPurchaseHandler,
  adjustSecuredLimitHandler,
  createCardHandler,
  deleteCardHandler,
  deletePurchaseHandler,
  getStatementHandler,
  listCardsHandler,
  setSecuredSourceHandler,
  setStatementPaidHandler,
  updateCardHandler,
} from "./cards.controller";

export const cardsRouter = Router();

cardsRouter.use(requireAuth);

cardsRouter.post("/", asyncHandler(createCardHandler));
cardsRouter.get("/", asyncHandler(listCardsHandler));
cardsRouter.patch("/:id", asyncHandler(updateCardHandler));
cardsRouter.delete("/:id", asyncHandler(deleteCardHandler));
cardsRouter.post("/:id/secured-limit", asyncHandler(adjustSecuredLimitHandler));
cardsRouter.patch("/:id/secured-source", asyncHandler(setSecuredSourceHandler));
cardsRouter.get("/:id/statement", asyncHandler(getStatementHandler));
cardsRouter.post("/:id/purchases", asyncHandler(addPurchaseHandler));
cardsRouter.delete("/:id/purchases/:purchaseId", asyncHandler(deletePurchaseHandler));
cardsRouter.patch("/:id/statements/:month", asyncHandler(setStatementPaidHandler));
