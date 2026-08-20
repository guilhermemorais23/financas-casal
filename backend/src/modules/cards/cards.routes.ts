import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  addPurchaseHandler,
  createCardHandler,
  deleteCardHandler,
  deletePurchaseHandler,
  getStatementHandler,
  listCardsHandler,
  setStatementPaidHandler,
  updateCardHandler,
} from "./cards.controller";

export const cardsRouter = Router();

cardsRouter.use(requireAuth);

cardsRouter.post("/", asyncHandler(createCardHandler));
cardsRouter.get("/", asyncHandler(listCardsHandler));
cardsRouter.patch("/:id", asyncHandler(updateCardHandler));
cardsRouter.delete("/:id", asyncHandler(deleteCardHandler));
cardsRouter.get("/:id/statement", asyncHandler(getStatementHandler));
cardsRouter.post("/:id/purchases", asyncHandler(addPurchaseHandler));
cardsRouter.delete("/:id/purchases/:purchaseId", asyncHandler(deletePurchaseHandler));
cardsRouter.patch("/:id/statements/:month", asyncHandler(setStatementPaidHandler));
