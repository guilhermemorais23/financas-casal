import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
import type { Plan } from "./billing.config";

// Uma assinatura por grupo (o casal paga uma vez só): subscriptions/{groupId}.
export type SubscriptionStatus = "trialing" | "pending" | "active" | "past_due" | "canceled";

export interface SubscriptionRow {
  groupId: string;
  status: SubscriptionStatus;
  plan: Plan | null;
  trialEndsAt: number;
  // Até quando o que já foi pago vale (fim do mês/ano pago).
  currentPeriodEnd: number | null;
  // Cortesia dada pelo admin: null = não tem; "forever" = pra sempre.
  courtesyUntil: number | "forever" | null;
  courtesyNote: string | null;
  asaasCustomerId: string | null;
  asaasSubscriptionId: string | null;
  // Página de pagamento da cobrança em aberto (Pix, boleto ou cartão).
  pendingInvoiceUrl: string | null;
  lastPaymentId: string | null;
  lastPaymentAt: number | null;
  payerUserId: string | null;
  payerName: string | null;
  termsVersion: string | null;
  termsAcceptedAt: number | null;
  canceledAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const col = db.collection("subscriptions");
const eventsCol = db.collection("billingEvents");
const auditCol = db.collection("adminAudit");

function toRow(doc: FirebaseFirestore.DocumentSnapshot): SubscriptionRow {
  const d = doc.data()!;
  return {
    groupId: doc.id,
    status: d.status,
    plan: d.plan ?? null,
    trialEndsAt: d.trialEndsAt ?? 0,
    currentPeriodEnd: d.currentPeriodEnd ?? null,
    courtesyUntil: d.courtesyUntil ?? null,
    courtesyNote: d.courtesyNote ?? null,
    asaasCustomerId: d.asaasCustomerId ?? null,
    asaasSubscriptionId: d.asaasSubscriptionId ?? null,
    pendingInvoiceUrl: d.pendingInvoiceUrl ?? null,
    lastPaymentId: d.lastPaymentId ?? null,
    lastPaymentAt: d.lastPaymentAt ?? null,
    payerUserId: d.payerUserId ?? null,
    payerName: d.payerName ?? null,
    termsVersion: d.termsVersion ?? null,
    termsAcceptedAt: d.termsAcceptedAt ?? null,
    canceledAt: d.canceledAt ?? null,
    createdAt: d.createdAt ?? 0,
    updatedAt: d.updatedAt ?? 0,
  };
}

export function findSubscription(groupId: string): Promise<SubscriptionRow | null> {
  return memoizeScoped(`subscription:${groupId}`, [`group:${groupId}`, "billing"], async () => {
    const doc = await col.doc(groupId).get();
    return doc.exists ? toRow(doc) : null;
  });
}

export async function findSubscriptionByAsaasId(asaasSubscriptionId: string): Promise<SubscriptionRow | null> {
  const snap = await col.where("asaasSubscriptionId", "==", asaasSubscriptionId).limit(1).get();
  return snap.empty ? null : toRow(snap.docs[0]);
}

// Cria o período de teste só se ainda não existe nada pro grupo (transação:
// duas abas abrindo ao mesmo tempo não criam dois testes).
export async function createTrialIfMissing(groupId: string, trialEndsAt: number): Promise<SubscriptionRow> {
  const ref = col.doc(groupId);
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (doc.exists) return toRow(doc);
    const now = Date.now();
    const row: Omit<SubscriptionRow, "groupId"> = {
      status: "trialing",
      plan: null,
      trialEndsAt,
      currentPeriodEnd: null,
      courtesyUntil: null,
      courtesyNote: null,
      asaasCustomerId: null,
      asaasSubscriptionId: null,
      pendingInvoiceUrl: null,
      lastPaymentId: null,
      lastPaymentAt: null,
      payerUserId: null,
      payerName: null,
      termsVersion: null,
      termsAcceptedAt: null,
      canceledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tx.set(ref, row);
    return { groupId, ...row };
  });
}

export async function updateSubscription(groupId: string, fields: Partial<Omit<SubscriptionRow, "groupId">>): Promise<void> {
  await col.doc(groupId).set({ ...fields, updatedAt: Date.now() }, { merge: true });
}

export async function listSubscriptions(limit = 300): Promise<SubscriptionRow[]> {
  const snap = await col.orderBy("updatedAt", "desc").limit(limit).get();
  return snap.docs.map(toRow);
}

// Guarda cada evento do Asaas uma vez só: o Asaas reenvia webhooks quando
// não recebe 200 a tempo, e o mesmo pagamento não pode ser aplicado duas vezes.
export async function recordEventOnce(eventKey: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    await eventsCol.doc(eventKey.replace(/\//g, "_")).create({ ...data, receivedAt: Date.now() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}

export interface BillingEventRow {
  id: string;
  event: string;
  groupId: string | null;
  value: number | null;
  receivedAt: number;
}

export async function listRecentEvents(limit = 30): Promise<BillingEventRow[]> {
  const snap = await eventsCol.orderBy("receivedAt", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({
    id: doc.id,
    event: doc.data().event,
    groupId: doc.data().groupId ?? null,
    value: doc.data().value ?? null,
    receivedAt: doc.data().receivedAt,
  }));
}

// Registro do que o admin fez (dar cortesia, cancelar...): quem, quando e o quê.
export async function recordAdminAction(entry: { adminEmail: string; action: string; groupId: string | null; detail: string }) {
  await auditCol.add({ ...entry, at: Date.now() });
}

export async function listAdminActions(limit = 30) {
  const snap = await auditCol.orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as { adminEmail: string; action: string; groupId: string | null; detail: string; at: number }) }));
}
