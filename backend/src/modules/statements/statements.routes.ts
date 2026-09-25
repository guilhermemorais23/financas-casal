import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requirePremium } from "../../middleware/requirePremium";
import { commitStatementHandler, previewStatementHandler } from "./statements.controller";

export const statementsRouter = Router();

statementsRouter.use(requireAuth);
// Importar extrato do banco é do Premium.
statementsRouter.use(requirePremium);
statementsRouter.post("/preview", asyncHandler(previewStatementHandler));
statementsRouter.post("/commit", asyncHandler(commitStatementHandler));
