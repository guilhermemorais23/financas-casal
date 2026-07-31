import type { Request, Response } from "express";
import {
  AlreadyInCoupleError,
  CoupleFullError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  acceptInvite,
  createCoupleForUser,
  getCoupleForUser,
} from "./couples.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createCoupleHandler(req: Request, res: Response) {
  try {
    const result = await createCoupleForUser(req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AlreadyInCoupleError) {
      res.status(409).json({ error: "user already belongs to a couple" });
      return;
    }
    throw err;
  }
}

export async function acceptInviteHandler(req: Request, res: Response) {
  const { token } = req.body ?? {};
  if (!isNonEmptyString(token)) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const result = await acceptInvite(req.user!.id, token.trim());
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InviteNotFoundError) {
      res.status(404).json({ error: "invite not found" });
      return;
    }
    if (err instanceof AlreadyInCoupleError) {
      res.status(409).json({ error: "user already belongs to a couple" });
      return;
    }
    if (err instanceof InviteNotPendingError || err instanceof InviteExpiredError) {
      res.status(409).json({ error: "invite is no longer valid" });
      return;
    }
    if (err instanceof CoupleFullError) {
      res.status(409).json({ error: "couple already has two members" });
      return;
    }
    throw err;
  }
}

export async function getMyCoupleHandler(req: Request, res: Response) {
  const result = await getCoupleForUser(req.user!.id);
  if (!result) {
    res.status(404).json({ error: "no couple yet" });
    return;
  }
  res.status(200).json(result);
}
