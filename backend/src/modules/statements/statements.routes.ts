import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { commitStatementHandler, previewStatementHandler } from "./statements.controller";

export const statementsRouter = Router();

statementsRouter.use(requireAuth);
statementsRouter.post("/preview", asyncHandler(previewStatementHandler));
statementsRouter.post("/commit", asyncHandler(commitStatementHandler));
