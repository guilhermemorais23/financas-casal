import type { Request, Response } from "express";
import { env } from "../../config/env";
import { runDueReminders } from "./reminders.service";

// Not a Firebase-authenticated route -- an external daily cron (cron-job.org,
// same one already used for the /api/health keep-alive ping) calls this with
// no signed-in user, so it's gated by a shared secret header instead.
// CRON_SECRET unset means the route is unreachable, same "off by default"
// posture as a missing RESEND_API_KEY.
export async function runRemindersHandler(req: Request, res: Response) {
  if (!env.cronSecret || req.header("x-cron-secret") !== env.cronSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const result = await runDueReminders();
  res.status(200).json(result);
}
