import { db } from "../../db/firestore";
import { listSubscriptions } from "../billing/billing.repository";
import { describeAccess } from "../billing/billing.service";
import { getAppSettings, isBillingEnabled } from "../settings/appSettings";
import { getFirestoreUsage } from "../../utils/firestoreUsage";

const DAY = 24 * 60 * 60 * 1000;
const usersCol = db.collection("users");

function millis(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return null;
}

// Admin > Visão geral: uso, retenção, funil, banco e as chaves do app.
// Tudo num select dos campos pequenos dos usuários (1 leitura por pessoa),
// só quando o admin abre a tela.
export async function getAdminInsights() {
  const now = Date.now();
  const [usersSnap, settings, billingOn] = await Promise.all([
    usersCol.select("groupId", "createdAt", "lastSeenAt").get(),
    getAppSettings(),
    isBillingEnabled(),
  ]);
  const users = usersSnap.docs.map((doc) => ({
    groupId: (doc.data().groupId as string | null) ?? null,
    createdAt: millis(doc.data().createdAt),
    lastSeenAt: millis(doc.data().lastSeenAt),
  }));

  const seenSince = (ms: number) => users.filter((u) => u.lastSeenAt !== null && u.lastSeenAt >= now - ms).length;
  const createdSince = (ms: number) => users.filter((u) => u.createdAt !== null && u.createdAt >= now - ms).length;

  // Retenção de 7 dias: de quem criou conta entre 8 e 37 dias atrás, quantos
  // voltaram pelo menos 7 dias depois de criar.
  const cohort = users.filter((u) => u.createdAt !== null && u.createdAt <= now - 8 * DAY && u.createdAt >= now - 37 * DAY);
  const returned = cohort.filter((u) => u.lastSeenAt !== null && u.lastSeenAt >= u.createdAt! + 7 * DAY).length;

  const membersByGroup = new Map<string, number>();
  for (const u of users) if (u.groupId) membersByGroup.set(u.groupId, (membersByGroup.get(u.groupId) ?? 0) + 1);
  const inGroup = users.filter((u) => u.groupId).length;
  const inPairedGroup = users.filter((u) => u.groupId && (membersByGroup.get(u.groupId) ?? 0) >= 2).length;

  let payingGroups: number | null = null;
  if (billingOn) {
    const subs = await listSubscriptions();
    payingGroups = subs.filter((s) => {
      const state = describeAccess(s, now).state;
      return (state === "active" || state === "past_due") && s.status !== "canceled";
    }).length;
  }

  return {
    activity: {
      today: seenSince(DAY),
      week: seenSince(7 * DAY),
      month: seenSince(30 * DAY),
      newWeek: createdSince(7 * DAY),
      newMonth: createdSince(30 * DAY),
      // lastSeenAt só começou a ser gravado com esta versão do backend.
      tracked: users.filter((u) => u.lastSeenAt !== null).length,
    },
    retention: { cohort: cohort.length, returned },
    funnel: {
      accounts: users.length,
      inGroup,
      inPairedGroup,
      payingGroups,
    },
    firestore: getFirestoreUsage(),
    settings: { ...settings, billingEnabled: billingOn },
  };
}
