import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { runRemindersHandler } from "./reminders.controller";

export const remindersRouter = Router();

// No requireAuth here on purpose -- see reminders.controller.ts, this is
// called by an external cron, not a signed-in user.
remindersRouter.post("/run", asyncHandler(runRemindersHandler));
