import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getQuotesHandler, getStockQuoteHandler } from "./quotes.controller";

export const quotesRouter = Router();

quotesRouter.use(requireAuth);
quotesRouter.get("/", asyncHandler(getQuotesHandler));
quotesRouter.get("/stock", asyncHandler(getStockQuoteHandler));
