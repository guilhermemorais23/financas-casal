import type { Request, Response } from "express";
import { getMonthCloseForUser, isMonthCloseSeen, markMonthCloseSeen } from "./monthClose.service";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function getMonthCloseHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  if (month !== undefined && !MONTH.test(month)) {
    res.status(400).json({ error: "month deve ser YYYY-MM" });
    return;
  }
  const close = await getMonthCloseForUser(req.user!.id, month);
  res.status(200).json({ ...close, seen: await isMonthCloseSeen(req.user!.id, close.month) });
}

export async function markMonthCloseSeenHandler(req: Request, res: Response) {
  const month = req.body?.month;
  if (typeof month !== "string" || !MONTH.test(month)) {
    res.status(400).json({ error: "month deve ser YYYY-MM" });
    return;
  }
  await markMonthCloseSeen(req.user!.id, month);
  res.status(204).end();
}
