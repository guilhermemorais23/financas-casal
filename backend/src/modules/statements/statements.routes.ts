import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requirePremium } from "../../middleware/requirePremium";
import {
  commitStatementHandler,
  deleteImportRuleHandler,
  listImportRulesHandler,
  previewStatementHandler,
  saveImportRuleHandler,
} from "./statements.controller";

export const statementsRouter = Router();

statementsRouter.use(requireAuth);
// As respostas guardadas continuam editáveis mesmo sem Premium.
statementsRouter.get("/rules", asyncHandler(listImportRulesHandler));
statementsRouter.put("/rules", asyncHandler(saveImportRuleHandler));
statementsRouter.delete("/rules/:key", asyncHandler(deleteImportRuleHandler));
// Importar extrato do banco é do Premium.
statementsRouter.use(requirePremium);
statementsRouter.post("/preview", asyncHandler(previewStatementHandler));
statementsRouter.post("/commit", asyncHandler(commitStatementHandler));
