import type { Request, Response } from "express";
import {
  AlreadyInGroupError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  NoGroupError,
  acceptInvite,
  createGroupForUser,
  createNewInvite,
  getGroupForUser,
  leaveGroup,
} from "./groups.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createGroupHandler(req: Request, res: Response) {
  try {
    const result = await createGroupForUser(req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof AlreadyInGroupError) {
      res.status(409).json({ error: "user already belongs to a group" });
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
    if (err instanceof AlreadyInGroupError) {
      res.status(409).json({ error: "user already belongs to a group" });
      return;
    }
    if (err instanceof InviteNotPendingError || err instanceof InviteExpiredError) {
      res.status(409).json({ error: "invite is no longer valid" });
      return;
    }
    throw err;
  }
}

export async function getMyGroupHandler(req: Request, res: Response) {
  const result = await getGroupForUser(req.user!.id);
  if (!result) {
    res.status(404).json({ error: "no group yet" });
    return;
  }
  res.status(200).json(result);
}

export async function createInviteHandler(req: Request, res: Response) {
  try {
    const inviteToken = await createNewInvite(req.user!.id);
    res.status(201).json({ inviteToken });
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function leaveGroupHandler(req: Request, res: Response) {
  try {
    await leaveGroup(req.user!.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}
