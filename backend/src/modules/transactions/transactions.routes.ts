import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createTransactionHandler,
  getBalanceHandler,
  listTransactionsHandler,
} from "./transactions.controller";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

transactionsRouter.post("/", asyncHandler(createTransactionHandler));
transactionsRouter.get("/", asyncHandler(listTransactionsHandler));
transactionsRouter.get("/balance", asyncHandler(getBalanceHandler));
