import { auth, db } from "../../db/firestore";
import { recordAdminAction } from "../billing/billing.repository";
import { describeAccess } from "../billing/billing.service";
import { findSubscription } from "../billing/billing.repository";
import { isBillingEnabled } from "../settings/appSettings";
import { isAdminEmail } from "./admin.service";
import { sendPasswordResetEmail } from "../../email/mailer";
import { deleteAccountForUser } from "../users/deleteAccount.service";

const usersCol = db.collection("users");

function millis(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return null;
}

export interface AdminUserRow {
  id: string;
  displayName: string;
  email: string;
  groupId: string | null;
  createdAt: number | null;
  lastSeenAt: number | null;
  blocked: boolean;
}

// Admin > Usuários: todo mundo, mais recentes primeiro. Lê só os campos da
// lista (select), não o perfil inteiro com foto.
export async function listUsersForAdmin(query: string): Promise<AdminUserRow[]> {
  const snap = await usersCol.select("displayName", "email", "groupId", "createdAt", "lastSeenAt", "blocked").limit(2000).get();
  const q = query.trim().toLowerCase();
  return snap.docs
    .map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        displayName: d.displayName ?? "",
        email: d.email ?? "",
        groupId: d.groupId ?? null,
        createdAt: millis(d.createdAt),
        lastSeenAt: millis(d.lastSeenAt),
        blocked: d.blocked === true,
      };
    })
    .filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.id === query.trim())
    .sort((a, b) => (b.lastSeenAt ?? b.createdAt ?? 0) - (a.lastSeenAt ?? a.createdAt ?? 0))
    .slice(0, 200);
}

export class AdminUserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function getUserDetailForAdmin(userId: string) {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) throw new AdminUserError("Usuário não encontrado.", 404);
  const d = doc.data()!;
  const groupId: string | null = d.groupId ?? null;

  const [members, transactionCount, accessSnap, sub, billingOn] = await Promise.all([
    groupId ? usersCol.where("groupId", "==", groupId).select("displayName", "email").get() : Promise.resolve(null),
    db.collection("transactions").where("payerId", "==", userId).count().get(),
    // Sem orderBy: um filtro só de igualdade não precisa de índice; ordena aqui.
    db.collection("accessLogs").where("userId", "==", userId).limit(50).get(),
    groupId ? findSubscription(groupId) : Promise.resolve(null),
    isBillingEnabled(),
  ]);
  const recentAccess = accessSnap.docs
    .map((a) => ({ event: a.data().event as string, createdAt: a.data().createdAt as number }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);

  return {
    id: doc.id,
    displayName: d.displayName ?? "",
    email: d.email ?? "",
    phone: d.phone ?? null,
    createdAt: millis(d.createdAt),
    lastSeenAt: millis(d.lastSeenAt),
    blocked: d.blocked === true,
    isAdmin: isAdminEmail(d.email ?? ""),
    group: groupId
      ? {
          id: groupId,
          members: (members?.docs ?? []).map((m) => ({ id: m.id, displayName: m.data().displayName ?? "", email: m.data().email ?? "" })),
        }
      : null,
    transactionCount: transactionCount.data().count,
    plan: billingOn ? describeAccess(sub) : null,
    recentAccess,
  };
}

// Bloquear: desliga o login no Firebase e derruba as sessões abertas (o
// token para de valer na próxima requisição). Desbloquear religa.
export async function setUserBlocked(adminEmail: string, userId: string, blocked: boolean): Promise<void> {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) throw new AdminUserError("Usuário não encontrado.", 404);
  const email = (doc.data()!.email as string) ?? "";
  if (isAdminEmail(email)) throw new AdminUserError("Não dá pra bloquear uma conta de admin.");

  await auth.updateUser(userId, { disabled: blocked });
  if (blocked) await auth.revokeRefreshTokens(userId);
  await usersCol.doc(userId).update({ blocked });
  await recordAdminAction({ adminEmail, action: blocked ? "block_user" : "unblock_user", groupId: null, detail: email });
}

// Mandar o link de trocar a senha pra pessoa (ela pediu ajuda pra entrar).
export async function sendPasswordResetForAdmin(adminEmail: string, userId: string): Promise<void> {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) throw new AdminUserError("Usuário não encontrado.", 404);
  const { email, displayName } = doc.data() as { email?: string; displayName?: string };
  if (!email) throw new AdminUserError("Essa conta não tem email.");
  const link = await auth.generatePasswordResetLink(email);
  const sent = await sendPasswordResetEmail(email, displayName ?? "", link);
  if (!sent.ok) throw new AdminUserError(`O email não saiu: ${sent.error ?? "sem provedor de email"}.`, 502);
  await recordAdminAction({ adminEmail, action: "password_reset_email", groupId: null, detail: email });
}

// Excluir a conta a pedido da pessoa (LGPD): o mesmo que ela faria em Conta e
// grupo > Excluir conta. O admin confirma digitando o email dela.
export async function deleteUserForAdmin(adminEmail: string, userId: string, confirmEmail: unknown): Promise<void> {
  const doc = await usersCol.doc(userId).get();
  if (!doc.exists) throw new AdminUserError("Usuário não encontrado.", 404);
  const email = (doc.data()!.email as string) ?? "";
  if (isAdminEmail(email)) throw new AdminUserError("Não dá pra excluir uma conta de admin por aqui.");
  if (typeof confirmEmail !== "string" || confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
    throw new AdminUserError("Digite o email da pessoa pra confirmar.");
  }
  await deleteAccountForUser(userId);
  await recordAdminAction({ adminEmail, action: "delete_user", groupId: null, detail: email });
}
