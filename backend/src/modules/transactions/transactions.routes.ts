import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createTransactionHandler,
  deleteTransactionHandler,
  exportTransactionsHandler,
  getBalanceHandler,
  getDailySeriesHandler,
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
transactionsRouter.get("/daily-series", asyncHandler(getDailySeriesHandler));
transactionsRouter.get("/export", asyncHandler(exportTransactionsHandler));
transactionsRouter.patch("/:id", asyncHandler(updateTransactionHandler));
transactionsRouter.delete("/:id", asyncHandler(deleteTransactionHandler));
