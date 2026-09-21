import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { InvalidMonthError } from "../../utils/month";
import { ShareNotFoundError, createShare, getPublicShare, revokeShare } from "./shares.service";

export async function createShareHandler(req: Request, res: Response) {
  try {
    const share = await createShare(req.user!.id, req.body?.month);
    res.status(201).json(share);
  } catch (err) {
    if (err instanceof InvalidMonthError) {
      res.status(400).json({ error: "month must be YYYY-MM" });
      return;
    }
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function revokeShareHandler(req: Request, res: Response) {
  try {
    await revokeShare(req.user!.id, String(req.params.id));
    res.status(204).end();
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      res.status(404).json({ error: "share not found" });
      return;
    }
    throw err;
  }
}

// Public: no auth. The unguessable token is the only credential.
export async function getPublicShareHandler(req: Request, res: Response) {
  try {
    const share = await getPublicShare(String(req.params.token));
    res.set("Cache-Control", "no-store");
    res.json(share);
  } catch (err) {
    if (err instanceof ShareNotFoundError) {
      res.status(404).json({ error: "Esse link não existe mais ou expirou." });
      return;
    }
    throw err;
  }
}
