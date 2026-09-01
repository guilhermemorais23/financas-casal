import type { Request, Response } from "express";
import { InvalidMonthError, getDashboardForUser } from "./dashboard.service";

export async function getDashboardHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;

  try {
    const dashboard = await getDashboardForUser(req.user!.id, month);
    if (!dashboard) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    res.status(200).json(dashboard);
  } catch (err) {
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "invalid month" });
      return;
    }
    throw err;
  }
}
