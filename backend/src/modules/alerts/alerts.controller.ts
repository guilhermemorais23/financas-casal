import type { Request, Response } from "express";
import { getAlertsForUser } from "./alerts.service";

export async function listAlertsHandler(req: Request, res: Response) {
  const alerts = await getAlertsForUser(req.user!.id);
  res.status(200).json(alerts);
}
