import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requirePremium } from "../../middleware/requirePremium";
import {
  connectTokenHandler,
  pendingHandler,
  previewHandler,
  registerItemHandler,
  removeHandler,
  statusHandler,
  syncedHandler,
} from "./openFinance.controller";

// Conectar conta (Open Finance pelo Pluggy). Como importar extrato, é Premium.
export const openFinanceRouter = Router();

openFinanceRouter.use(requireAuth);
openFinanceRouter.get("/status", asyncHandler(statusHandler));
openFinanceRouter.get("/pending", asyncHandler(pendingHandler));
openFinanceRouter.use(requirePremium);
openFinanceRouter.post("/connect-token", asyncHandler(connectTokenHandler));
openFinanceRouter.post("/items", asyncHandler(registerItemHandler));
openFinanceRouter.post("/items/:itemId/preview", asyncHandler(previewHandler));
openFinanceRouter.post("/items/:itemId/synced", asyncHandler(syncedHandler));
openFinanceRouter.delete("/items/:itemId", asyncHandler(removeHandler));
