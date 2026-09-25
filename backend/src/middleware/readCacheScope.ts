import type { NextFunction, Request, Response } from "express";
import { findUserById } from "../modules/users/users.repository";
import { invalidateAllReads, invalidateScopes, runWithReadScope } from "../utils/readCache";

// Rotas que gravam só coisas que não ficam em cache (log de acesso, "já vi"
// dos pop-ups, feedback) -- não precisam jogar cache fora.
const NO_CACHED_WRITES = new Set(["announcements", "feedback"]);
// Rotas que mexem em quem é de qual grupo, na conta da pessoa ou que chegam
// sem usuário (webhooks do Telegram/WhatsApp): mais seguro jogar tudo fora.
const INVALIDATE_ALL = new Set(["me", "groups", "admin", "public"]);

// Liga o cache de leituras (utils/readCache.ts) só pra GET e, depois de toda
// requisição que grava, descarta o que pode ter ficado velho.
export function readCacheScope(req: Request, res: Response, next: NextFunction) {
  const cacheable = req.method === "GET";
  if (!cacheable) {
    const family = req.path.split("/")[1] ?? "";
    const isLoginEvent = req.path === "/me/login-event";
    res.on("finish", () => {
      if (isLoginEvent || NO_CACHED_WRITES.has(family)) return;
      const userId = req.user?.id;
      if (!userId || INVALIDATE_ALL.has(family)) {
        invalidateAllReads();
        return;
      }
      runWithReadScope(false, () => findUserById(userId))
        .then((user) => {
          invalidateScopes([`user:${userId}`, family, ...(user?.groupId ? [`group:${user.groupId}`] : [])]);
        })
        .catch(() => invalidateAllReads());
    });
  }
  runWithReadScope(cacheable, next);
}
