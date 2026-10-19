// ============================================================================
// requireAuth: CONFERE QUEM ESTÁ PEDINDO -- roda antes das rotas protegidas
// ============================================================================
// Um "middleware" é uma função que roda ANTES da rota. Os módulos usam assim:
//   debtsRouter.use(requireAuth);   // toda rota de dívidas exige login
//
// O que ele faz, em ordem:
//   1. pega o token do cabeçalho "Authorization: Bearer <token>" (quem põe
//      esse cabeçalho é o apiRequest, em frontend/src/api/client.ts);
//   2. pergunta ao Firebase se o token é válido, de quem é e se não foi
//      revogado. Não é? Responde 401 e o pedido para aqui;
//   3. guarda quem é em req.user ({ id, email }) -- daí em diante o
//      controller e o service sabem quem pediu;
//   4. em modo manutenção, só deixa ler (GET), a não ser pra admin;
//   5. lê o grupo aberto (cabeçalho X-Group-Id) e chama next(), que passa
//      o pedido pra próxima etapa (a rota).
// Rotas SEM requireAuth são de propósito: /api/health, webhooks (Telegram,
// WhatsApp, Asaas, Pluggy -- conferidos por segredo) e o link público.
// ============================================================================
import type { NextFunction, Request, Response } from "express";
import { auth, db } from "../db/firestore";
import { isAdminEmail } from "../modules/admin/admin.service";
import { getAppSettings } from "../modules/settings/appSettings";
import type { AuthenticatedUser } from "../types/express";
import { parseGroupIdHeader, runWithActiveGroup } from "../utils/activeGroup";
import { todayInBrazil } from "../utils/month";

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const idToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!idToken) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }

  try {
    // O checkRevoked (2º argumento) custa uma consulta a mais no Firebase Auth
    // por pedido, mas sem ele o token continua "válido" (só assinatura e
    // validade) até expirar sozinho (~1h), mesmo depois de
    // auth.revokeRefreshTokens() -- o que anularia o "sair de todos os
    // dispositivos" (ver revokeSessionsHandler).
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
  const today = todayInBrazil();
  if (seenDay.get(userId) === today) return;
  seenDay.set(userId, today);
  if (seenDay.size > 20000) seenDay.clear();
  // update (não set): perfil que ainda não existe (primeiro login) não é criado aqui.
  db.collection("users").doc(userId).update({ lastSeenAt: Date.now() }).catch(() => seenDay.delete(userId));
}
