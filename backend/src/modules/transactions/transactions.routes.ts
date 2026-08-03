import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createTransactionHandler,
  deleteTransactionHandler,
  getBalanceHandler,
  getSummaryHandler,
  listTransactionsHandler,
  updateTransactionHandler,
} from "./transactions.controller";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.post("/", asyncHandler(createTransactionHandler));
transactionsRouter.get("/", asyncHandler(listTransactionsHandler));
transactionsRouter.get("/balance", asyncHandler(getBalanceHandler));
transactionsRouter.get("/summary", asyncHandler(getSummaryHandler));
transactionsRouter.patch("/:id", asyncHandler(updateTransactionHandler));
transactionsRouter.delete("/:id", asyncHandler(deleteTransactionHandler));
