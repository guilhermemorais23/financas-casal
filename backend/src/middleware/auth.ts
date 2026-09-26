import type { NextFunction, Request, Response } from "express";
import { auth, db } from "../db/firestore";
import { isAdminEmail } from "../modules/admin/admin.service";
import { getAppSettings } from "../modules/settings/appSettings";
import type { AuthenticatedUser } from "../types/express";
import { parseGroupIdHeader, runWithActiveGroup } from "../utils/activeGroup";

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
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  markSeenToday(req.user.id);

  // Modo manutenção (Admin > Visão geral): dá pra ver tudo, mas gravar fica
  // pausado pra quem não é admin. Webhooks não passam por aqui (pagamentos
  // continuam sendo registrados).
  if (req.method !== "GET") {
    try {
      const { maintenance } = await getAppSettings();
      if (maintenance.enabled && !isAdminEmail(req.user.email)) {
        res.status(503).json({ error: maintenance.message, code: "maintenance" });
        return;
      }
    } catch {
      // Sem conseguir ler a configuração, não trava ninguém.
    }
  }
  // Grupo aberto no app (quem está em mais de um grupo). Só é usado depois
  // de requireGroupId conferir que a pessoa é membro dele.
  const activeGroupId = parseGroupIdHeader(req.header("x-group-id"));
  req.activeGroupId = activeGroupId;
  runWithActiveGroup(activeGroupId, next);
}

// "Visto por último" (users.lastSeenAt), no máximo uma gravação por pessoa
// por dia -- é o que alimenta ativos por dia/semana/mês e retenção no Admin.
const seenDay = new Map<string, string>();
function markSeenToday(userId: string): void {
  const today = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (seenDay.get(userId) === today) return;
  seenDay.set(userId, today);
  if (seenDay.size > 20000) seenDay.clear();
  // update (não set): perfil que ainda não existe (primeiro login) não é criado aqui.
  db.collection("users").doc(userId).update({ lastSeenAt: Date.now() }).catch(() => seenDay.delete(userId));
}
