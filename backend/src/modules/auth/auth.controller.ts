import type { Request, Response } from "express";
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  login,
  register,
  toPublicUser,
} from "./auth.service";
import { findUserById } from "./users.repository";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function registerHandler(req: Request, res: Response) {
  const { email, password, displayName } = req.body ?? {};

  if (!isNonEmptyString(email) || !isNonEmptyString(password) || !isNonEmptyString(displayName)) {
    res.status(400).json({ error: "email, password and displayName are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "password must be at least 8 characters" });
    return;
  }

  try {
    const result = await register({ email: email.toLowerCase().trim(), password, displayName: displayName.trim() });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof EmailAlreadyRegisteredError) {
      res.status(409).json({ error: "email already registered" });
      return;
    }
    throw err;
  }
}

export async function loginHandler(req: Request, res: Response) {
  const { email, password } = req.body ?? {};

  if (!isNonEmptyString(email) || !isNonEmptyString(password)) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }

  try {
    const result = await login({ email: email.toLowerCase().trim(), password });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    throw err;
  }
}

export async function meHandler(req: Request, res: Response) {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  res.status(200).json(toPublicUser(user));
}
