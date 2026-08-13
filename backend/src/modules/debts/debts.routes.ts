import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createDebtHandler,
  deleteDebtHandler,
  listDebtsHandler,
  setInstallmentPaidHandler,
  updateDebtHandler,
} from "./debts.controller";

export const debtsRouter = Router();

debtsRouter.use(requireAuth);

debtsRouter.post("/", asyncHandler(createDebtHandler));
debtsRouter.get("/", asyncHandler(listDebtsHandler));
debtsRouter.patch("/:debtId/installments/:installmentId", asyncHandler(setInstallmentPaidHandler));
debtsRouter.patch("/:id", asyncHandler(updateDebtHandler));
debtsRouter.delete("/:id", asyncHandler(deleteDebtHandler));
