import type { Request, Response } from "express";
import { findUserById, upsertUserProfile } from "./users.repository";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toPublicUser(user: { id: string; email: string; displayName: string; groupId: string | null }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    groupId: user.groupId,
  };
}

// Firebase Auth owns credentials; this just makes sure a Firestore profile
// doc exists for the signed-in user. Idempotent -- safe to call on every
// sign-in, not just the first one ever.
export async function bootstrapHandler(req: Request, res: Response) {
  const { displayName } = req.body ?? {};
  if (!isNonEmptyString(displayName)) {
    res.status(400).json({ error: "displayName is required" });
    return;
  }

  const user = await upsertUserProfile({
    id: req.user!.id,
    email: req.user!.email,
    displayName: displayName.trim(),
  });
  res.status(200).json(toPublicUser(user));
}

export async function meHandler(req: Request, res: Response) {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  res.status(200).json(toPublicUser(user));
}
