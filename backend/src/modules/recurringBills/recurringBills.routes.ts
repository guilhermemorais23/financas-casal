import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createRecurringBillHandler,
  deleteRecurringBillHandler,
  listRecurringBillsHandler,
  updateRecurringBillHandler,
} from "./recurringBills.controller";

export const recurringBillsRouter = Router();

recurringBillsRouter.use(requireAuth);

recurringBillsRouter.post("/", asyncHandler(createRecurringBillHandler));
recurringBillsRouter.get("/", asyncHandler(listRecurringBillsHandler));
recurringBillsRouter.patch("/:id", asyncHandler(updateRecurringBillHandler));
recurringBillsRouter.delete("/:id", asyncHandler(deleteRecurringBillHandler));
