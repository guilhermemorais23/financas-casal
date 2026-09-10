import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { getAlertsForUser } from "./alerts.service";

export async function listAlertsHandler(req: Request, res: Response) {
  try {
    const alerts = await getAlertsForUser(req.user!.id);
    res.status(200).json(alerts);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}
