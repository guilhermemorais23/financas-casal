// ============================================================================
// MÓDULO users -- endereços /api/me
// ============================================================================
// O que faz: o perfil de quem está logado -- criar no primeiro login
//            (bootstrap), ler (/me), editar nome/foto/e-mail, registrar login
//            pro Admin, "já vi as boas-vindas", sair de todos os
//            dispositivos e excluir a conta.
// Quem chama: auth/AuthContext.tsx (login e perfil), a janela de perfil e a
//             tela Conta.
// Este módulo não tem users.routes.ts: as rotas /api/me são registradas
// direto no app.ts (procure "/api/me" lá).
// ============================================================================
import type { Request, Response } from "express";
import { isAdminEmail } from "../admin/admin.service";
import { getAppSettings, isBillingEnabled } from "../settings/appSettings";
import { logAccess, type AccessEvent } from "../../utils/accessLog";
import { sendNewSignupEmail, sendWelcomeEmail } from "../../email/mailer";
import { auth } from "../../db/firestore";
import { deleteAccountForUser } from "./deleteAccount.service";
import { findUserById, markWelcomeSeen, updateUserProfile, upsertUserProfile, type UserRow } from "./users.repository";
import { isNonEmptyString } from "../../utils/validation";

// O isAdmin aqui é o que o frontend usa pra decidir se mostra o item Admin no
// menu -- a rota do backend confere o ADMIN_EMAILS de novo, por conta
// própria (admin.controller.ts), então isto é só uma trava de tela (quem não
// pode entrar nunca vê "Admin" no menu), e não a barreira de segurança.
async function toPublicUser(user: UserRow) {
  // Chaves do app que mudam o que a tela mostra: a tela Plano só aparece com
  // a cobrança ligada; o aviso de manutenção aparece pra todo mundo.
  const settings = await getAppSettings().catch(() => null);
  const billingEnabled = await isBillingEnabled().catch(() => false);
  return {
    billingEnabled,
    maintenance: settings?.maintenance.enabled ? settings.maintenance.message : null,
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    groupId: user.groupId,
    groupIds: user.groupIds,
    photoDataUrl: user.photoDataUrl,
    phone: user.phone,
    isAdmin: isAdminEmail(user.email),
    welcomePending: user.welcomePending,
  };
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Uma foto pequena e comprimida (o navegador reduz antes de codificar) cabe
// com folga -- sobra espaço pro aumento do base64 e ainda fica bem longe do
// limite de 1MB por documento do Firestore.
const MAX_PHOTO_DATA_URL_LENGTH = 300_000;

// O Firebase Auth cuida das credenciais; isto só garante que existe um
// documento de perfil no Firestore pra quem entrou. Pode chamar várias vezes
// -- é seguro em todo login, não só no primeiro.
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
    void sendNewSignupEmail(user);
  }

  // O isNew deixa o frontend mostrar a apresentação de boas-vindas só pra
  // conta nova de verdade (inclusive no primeiro login com Google/Apple, que
  // nunca passa pelo formulário "Criar conta").
  res.status(200).json({ ...(await toPublicUser(user)), isNew });
}

// Chamado de propósito pelo frontend logo depois de um login de verdade
// (e-mail, Google ou cadastro) -- NÃO pela renovação silenciosa do token (o
// onIdTokenChanged dispara mais ou menos a cada hora e encheria isto de
// "logins" falsos). Serve só pra tela Admin > Logs "quem está entrando"; não
// leva senha nem token, só quem e quando.
export async function logLoginEventHandler(req: Request, res: Response) {
  const { event } = req.body ?? {};
  const validEvent: AccessEvent = event === "register" ? "register" : "login";
  logAccess(validEvent, { userId: req.user!.id, email: req.user!.email });
  res.status(204).send();
}

export async function meHandler(req: Request, res: Response) {
  const user = await findUserById(req.user!.id);
  if (!user) {
    res.status(404).json({ error: "user not found" });
    return;
  }
  res.status(200).json(await toPublicUser(user));
}

// A apresentação aparece uma vez só: o app chama isto assim que ela abre
// (não só quando a pessoa fecha), então atualizar a página ou trocar de
// aparelho não mostra de novo. Novidades depois disso vão pelo Admin >
// Novidades.
export async function welcomeSeenHandler(req: Request, res: Response) {
  await markWelcomeSeen(req.user!.id);
  res.status(204).end();
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

  // O Firebase Auth é dono da credencial -- isto só mantém a nossa cópia no
  // Firestore igual depois que o navegador já mudou lá (o
  // verifyBeforeUpdateEmail manda um link de confirmação; a gente já espelha o
  // endereço novo na hora, em vez de acompanhar esse fluxo assíncrono).
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
  res.status(200).json(await toPublicUser(user));
}

// "Sair de todos os dispositivos": invalida todo refresh token que o
// Firebase emitiu pra este usuário, então todo outro aparelho logado (e este
// também, quando o token dele vencer ou for conferido com checkRevoked -- ver
// middleware/auth.ts) é deslogado. O Firebase não tem uma API de "listar
// sessões ativas" pra mostrar antes; é a mesma revogação tudo-ou-nada que os
// grandes provedores oferecem.
export async function revokeSessionsHandler(req: Request, res: Response) {
  await auth.revokeRefreshTokens(req.user!.id);
  res.status(204).send();
}

// "Excluir conta" -- apaga de vez os dados da pessoa e o login dela (ver
// deleteAccount.service.ts pra saber exatamente o que vai e o que fica com o
// resto do grupo).
export async function deleteAccountHandler(req: Request, res: Response) {
  await deleteAccountForUser(req.user!.id);
  res.status(204).send();
}
