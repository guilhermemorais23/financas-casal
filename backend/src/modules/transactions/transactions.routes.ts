import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requirePremium } from "../../middleware/requirePremium";
import {
  cancelRecurringHandler,
  createTransactionHandler,
  deleteTransactionHandler,
  exportTransactionsHandler,
  getBalanceHandler,
  getDailySeriesHandler,
  getSummaryHandler,
  getYearlySummaryHandler,
  listTransactionsHandler,
  setSplitSettledHandler,
  splitByCategoryHandler,
  updateRecurringHandler,
  updateTransactionHandler,
} from "./transactions.controller";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.post("/", asyncHandler(createTransactionHandler));
transactionsRouter.get("/", asyncHandler(listTransactionsHandler));
transactionsRouter.get("/balance", asyncHandler(getBalanceHandler));
transactionsRouter.get("/summary", asyncHandler(getSummaryHandler));
transactionsRouter.get("/summary/year", asyncHandler(getYearlySummaryHandler));
transactionsRouter.get("/daily-series", asyncHandler(getDailySeriesHandler));
// Exportar (CSV) é do Premium.
transactionsRouter.get("/export", requirePremium, asyncHandler(exportTransactionsHandler));
transactionsRouter.patch("/:id/settle", asyncHandler(setSplitSettledHandler));
transactionsRouter.post("/:id/split-category", asyncHandler(splitByCategoryHandler));
transactionsRouter.patch("/:id/recurring", asyncHandler(updateRecurringHandler));
transactionsRouter.patch("/:id", asyncHandler(updateTransactionHandler));
transactionsRouter.delete("/:id/recurring", asyncHandler(cancelRecurringHandler));
transactionsRouter.delete("/:id", asyncHandler(deleteTransactionHandler));
