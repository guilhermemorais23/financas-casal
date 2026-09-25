import { db } from "../../db/firestore";
import { listRecentAccess, type AccessLogEntry } from "../../utils/accessLog";
import { isQuotaError, listMemoryErrors, listRecentErrors, type ErrorLogEntry } from "../../utils/errorLog";

export class NotAdminError extends Error {}

const usersCol = db.collection("users");
const groupsCol = db.collection("groups");
const telegramLinksCol = db.collection("telegramLinks");
const whatsappLinksCol = db.collection("whatsappLinks");

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.toLowerCase());
}

export function requireAdminEmail(email: string): void {
  if (!isAdminEmail(email)) {
    throw new NotAdminError();
  }
}

export interface AdminOverview {
  totalUsers: number;
  totalGroups: number;
  pairedGroups: number;
  soloGroups: number;
  telegramLinked: number;
  whatsappLinked: number;
  recentErrors: ErrorLogEntry[];
  recentAccess: AccessLogEntry[];
  // true quando o Firestore não respondeu (ex.: cota do dia estourada): os
  // números vêm zerados e os erros vêm da memória do servidor.
  firestoreUnavailable?: boolean;
}

// "Casal completo" (paired) vs "sozinho" (solo) isn't a stored flag -- it's
// derived by counting how many users share each groupId. Reading just the
// groupId field (not full user docs) keeps this cheap even as the user
// count grows.
export async function getAdminOverview(): Promise<AdminOverview> {
  try {
    return await loadAdminOverview();
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    return {
      totalUsers: 0,
      totalGroups: 0,
      pairedGroups: 0,
      soloGroups: 0,
      telegramLinked: 0,
      whatsappLinked: 0,
      recentErrors: listMemoryErrors(20),
      recentAccess: [],
      firestoreUnavailable: true,
    };
  }
}

async function loadAdminOverview(): Promise<AdminOverview> {
  const [userCountSnap, groupCountSnap, telegramCountSnap, whatsappCountSnap, userGroupIds, recentErrors, recentAccess] =
    await Promise.all([
      usersCol.count().get(),
      groupsCol.count().get(),
      telegramLinksCol.count().get(),
      whatsappLinksCol.count().get(),
      usersCol.select("groupId").get(),
      listRecentErrors(20),
      listRecentAccess(20),
    ]);

  const membersByGroup = new Map<string, number>();
  for (const doc of userGroupIds.docs) {
    const groupId = doc.data().groupId as string | null | undefined;
    if (!groupId) continue;
    membersByGroup.set(groupId, (membersByGroup.get(groupId) ?? 0) + 1);
  }

  let pairedGroups = 0;
  let soloGroups = 0;
  for (const memberCount of membersByGroup.values()) {
    if (memberCount >= 2) pairedGroups++;
    else soloGroups++;
  }

  return {
    totalUsers: userCountSnap.data().count,
    totalGroups: groupCountSnap.data().count,
    pairedGroups,
    soloGroups,
    telegramLinked: telegramCountSnap.data().count,
    whatsappLinked: whatsappCountSnap.data().count,
    recentErrors,
    recentAccess,
  };
}
