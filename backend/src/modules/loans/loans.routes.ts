import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  addRepaymentHandler,
  createLoanHandler,
  deleteLoanHandler,
  listLoansHandler,
  removeRepaymentHandler,
  updateLoanHandler,
} from "./loans.controller";

export const loansRouter = Router();
loansRouter.use(requireAuth);
loansRouter.get("/", asyncHandler(listLoansHandler));
loansRouter.post("/", asyncHandler(createLoanHandler));
loansRouter.patch("/:id", asyncHandler(updateLoanHandler));
loansRouter.delete("/:id", asyncHandler(deleteLoanHandler));
loansRouter.post("/:id/repayments", asyncHandler(addRepaymentHandler));
loansRouter.delete("/:id/repayments/:repaymentId", asyncHandler(removeRepaymentHandler));
