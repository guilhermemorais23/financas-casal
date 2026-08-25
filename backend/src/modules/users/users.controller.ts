import type { Request, Response } from "express";
import { sendWelcomeEmail } from "../../email/resend";
import { findUserById, updateUserProfile, upsertUserProfile, type UserRow } from "./users.repository";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    groupId: user.groupId,
    photoDataUrl: user.photoDataUrl,
    phone: user.phone,
  };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// A compressed small avatar (client resizes before encoding) comfortably
// fits well under this -- generous headroom for the base64 blow-up, still
// nowhere near Firestore's 1MB document cap.
const MAX_PHOTO_DATA_URL_LENGTH = 300_000;

// Firebase Auth owns credentials; this just makes sure a Firestore profile
// doc exists for the signed-in user. Idempotent -- safe to call on every
// sign-in, not just the first one ever.
export async function bootstrapHandler(req: Request, res: Response) {
  const { displayName } = req.body ?? {};
  if (!isNonEmptyString(displayName)) {
    res.status(400).json({ error: "displayName is required" });
    return;
  }

  const { user, isNew } = await upsertUserProfile({
    id: req.user!.id,
    email: req.user!.email,
    displayName: displayName.trim(),
  });

  if (isNew) {
    void sendWelcomeEmail(user.email, user.displayName);
  }

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

export async function updateProfileHandler(req: Request, res: Response) {
  const { displayName, photoDataUrl, phone, email } = req.body ?? {};

  const updates: { displayName?: string; photoDataUrl?: string | null; phone?: string | null; email?: string } = {};

  if (displayName !== undefined) {
    if (!isNonEmptyString(displayName)) {
      res.status(400).json({ error: "displayName must be a non-empty string" });
      return;
    }
    updates.displayName = displayName.trim();
  }

  if (phone !== undefined) {
    if (phone !== null && typeof phone !== "string") {
      res.status(400).json({ error: "phone must be a string or null" });
      return;
    }
    updates.phone = phone === null || phone.trim() === "" ? null : phone.trim();
  }

  // Firebase Auth owns the credential itself -- this only keeps our own
  // Firestore copy in sync after the client has already changed it there
  // (verifyBeforeUpdateEmail sends a confirmation link; we mirror the
  // intended address immediately rather than tracking that async flow).
  if (email !== undefined) {
    if (!isNonEmptyString(email) || !isValidEmail(email)) {
      res.status(400).json({ error: "email must be a valid email address" });
      return;
    }
    updates.email = email.trim();
  }

  if (photoDataUrl !== undefined) {
    if (photoDataUrl !== null && (typeof photoDataUrl !== "string" || !photoDataUrl.startsWith("data:image/"))) {
      res.status(400).json({ error: "photoDataUrl must be a data:image/... URL or null" });
      return;
    }
    if (typeof photoDataUrl === "string" && photoDataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
      res.status(400).json({ error: "photo is too large" });
      return;
    }
    updates.photoDataUrl = photoDataUrl;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "nothing to update" });
    return;
  }

  const user = await updateUserProfile(req.user!.id, updates);
  res.status(200).json(toPublicUser(user));
}
