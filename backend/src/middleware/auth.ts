import type { NextFunction, Request, Response } from "express";
import { auth } from "../db/firestore";
import type { AuthenticatedUser } from "../types/express";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const idToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!idToken) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  try {
    const decoded = await auth.verifyIdToken(idToken);
    const user: AuthenticatedUser = {
      id: decoded.uid,
      email: decoded.email ?? "",
    };
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
