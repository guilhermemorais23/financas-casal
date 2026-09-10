import type { Request, Response } from "express";
import { env } from "../../config/env";
import { generateDueRecurringBills } from "../recurringBills/recurringBills.service";
import { runDueReminders } from "./reminders.service";

// Not a Firebase-authenticated route -- an external daily cron (cron-job.org,
// same one already used for the /api/health keep-alive ping) calls this with
// no signed-in user, so it's gated by a shared secret header instead.
// CRON_SECRET unset means the route is unreachable, same "off by default"
// posture as missing Gmail SMTP credentials (see email/mailer.ts).
//
// Recurring bills piggyback on this exact same daily hit (rather than a
// second cron-job.org job) -- both are "once a day, no per-user context"
// background work, and this is the one external trigger that already
// exists and is already configured in production.
export async function runRemindersHandler(req: Request, res: Response) {
  if (!env.cronSecret || req.header("x-cron-secret") !== env.cronSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const [reminders, recurringBills] = await Promise.all([runDueReminders(), generateDueRecurringBills()]);
  res.status(200).json({ reminders, recurringBills });
}
