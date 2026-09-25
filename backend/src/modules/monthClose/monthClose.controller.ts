import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { getMonthCloseForUser } from "./monthClose.service";

export async function getMonthCloseHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ error: "month deve ser YYYY-MM" });
    return;
  }
  try {
    res.status(200).json(await getMonthCloseForUser(req.user!.id, month));
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}
