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
    // checkRevoked (2nd arg) costs one extra Firebase Auth lookup per
    // request, but without it a token stays "valid" (signature/expiry
    // check alone) up to its natural ~1h expiry even after
    // auth.revokeRefreshTokens() -- which defeats the point of a
    // self-service "sign out everywhere" (see revokeSessionsHandler).
    const decoded = await auth.verifyIdToken(idToken, true);
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
