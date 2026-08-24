import type { Request, Response } from "express";
import { getAdminOverview, NotAdminError, requireAdminEmail } from "./admin.service";

export async function getAdminOverviewHandler(req: Request, res: Response) {
  try {
    requireAdminEmail(req.user!.email);
  } catch (err) {
    if (err instanceof NotAdminError) {
      res.status(403).json({ error: "not an admin" });
      return;
    }
    throw err;
  }

  const overview = await getAdminOverview();
  res.status(200).json(overview);
}
