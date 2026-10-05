import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createRecurringBillHandler,
  deleteRecurringBillHandler,
  listBillRemindersHandler,
  listRecurringBillsHandler,
  payBillHandler,
  snoozeBillHandler,
  updateRecurringBillHandler,
} from "./recurringBills.controller";

export const recurringBillsRouter = Router();

recurringBillsRouter.use(requireAuth);

recurringBillsRouter.post("/", asyncHandler(createRecurringBillHandler));
recurringBillsRouter.get("/", asyncHandler(listRecurringBillsHandler));
recurringBillsRouter.get("/reminders", asyncHandler(listBillRemindersHandler));
recurringBillsRouter.post("/:id/pay", asyncHandler(payBillHandler));
recurringBillsRouter.post("/:id/snooze", asyncHandler(snoozeBillHandler));
recurringBillsRouter.patch("/:id", asyncHandler(updateRecurringBillHandler));
recurringBillsRouter.delete("/:id", asyncHandler(deleteRecurringBillHandler));
