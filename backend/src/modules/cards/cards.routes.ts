import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  addPurchaseHandler,
  adjustSecuredLimitHandler,
  createCardHandler,
  deleteCardHandler,
  deletePurchaseHandler,
  getCreditCardPreferenceHandler,
  getStatementHandler,
  moveTransactionToCardHandler,
  setCreditCardPreferenceHandler,
  setSavingsPlanHandler,
  updatePurchaseHandler,
  listCardsHandler,
  setSecuredSourceHandler,
  setStatementPaidHandler,
  updateCardHandler,
} from "./cards.controller";

export const cardsRouter = Router();

cardsRouter.use(requireAuth);

cardsRouter.post("/", asyncHandler(createCardHandler));
cardsRouter.get("/", asyncHandler(listCardsHandler));
cardsRouter.get("/preference", asyncHandler(getCreditCardPreferenceHandler));
cardsRouter.put("/preference", asyncHandler(setCreditCardPreferenceHandler));
cardsRouter.patch("/:id", asyncHandler(updateCardHandler));
cardsRouter.delete("/:id", asyncHandler(deleteCardHandler));
cardsRouter.post("/:id/secured-limit", asyncHandler(adjustSecuredLimitHandler));
cardsRouter.patch("/:id/secured-source", asyncHandler(setSecuredSourceHandler));
cardsRouter.get("/:id/statement", asyncHandler(getStatementHandler));
cardsRouter.post("/:id/purchases", asyncHandler(addPurchaseHandler));
cardsRouter.post("/:id/purchases/from-transaction", asyncHandler(moveTransactionToCardHandler));
cardsRouter.patch("/:id/purchases/:purchaseId", asyncHandler(updatePurchaseHandler));
cardsRouter.put("/:id/savings-plan", asyncHandler(setSavingsPlanHandler));
cardsRouter.delete("/:id/purchases/:purchaseId", asyncHandler(deletePurchaseHandler));
cardsRouter.patch("/:id/statements/:month", asyncHandler(setStatementPaidHandler));
