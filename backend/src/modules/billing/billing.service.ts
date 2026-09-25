import { escapeHtml, sendOwnerEmail } from "../../email/mailer";
import { isValidCpfCnpj, onlyDigits } from "../../utils/cpfCnpj";
import { invalidateScopes } from "../../utils/readCache";
import { findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { findUserById } from "../users/users.repository";
import * as asaas from "./asaas.client";
import { billingConfig, priceFor, TERMS_VERSION, type Plan } from "./billing.config";
import {
  createTrialIfMissing,
  findSubscription,
  findSubscriptionByAsaasId,
  listAdminActions,
  listRecentEvents,
  listSubscriptions,
  recordAdminAction,
  recordEventOnce,
  updateSubscription,
  type SubscriptionRow,
} from "./billing.repository";

const DAY = 24 * 60 * 60 * 1000;
// Direito de arrependimento (Código de Defesa do Consumidor, art. 49):
// compra pela internet pode ser desfeita em até 7 dias com reembolso integral.
const REFUND_WINDOW_MS = 7 * DAY;

export class BillingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Quem tem Premium
// ---------------------------------------------------------------------------

export type AccessState = "trial" | "active" | "past_due" | "canceled_active" | "courtesy" | "free";

export interface Entitlement {
  billingEnabled: boolean;
  premium: boolean;
  state: AccessState;
  // Até quando vale o estado atual (fim do teste, do período pago, da cortesia).
  endsAt: number | null;
}

export function describeAccess(sub: SubscriptionRow | null, now = Date.now()): Entitlement {
  const { graceDays } = billingConfig();
  const base = { billingEnabled: true };
  if (!sub) return { ...base, premium: false, state: "free", endsAt: null };

  if (sub.courtesyUntil === "forever" || (typeof sub.courtesyUntil === "number" && sub.courtesyUntil > now)) {
    return { ...base, premium: true, state: "courtesy", endsAt: sub.courtesyUntil === "forever" ? null : sub.courtesyUntil };
  }
  const paidUntil = sub.currentPeriodEnd;
  if (sub.status === "active" && paidUntil && paidUntil > now) {
    return { ...base, premium: true, state: "active", endsAt: paidUntil };
  }
  if ((sub.status === "active" || sub.status === "past_due") && paidUntil && paidUntil + graceDays * DAY > now) {
    return { ...base, premium: true, state: "past_due", endsAt: paidUntil + graceDays * DAY };
  }
  if (sub.status === "canceled" && paidUntil && paidUntil > now) {
    return { ...base, premium: true, state: "canceled_active", endsAt: paidUntil };
  }
  if (sub.trialEndsAt > now) {
    return { ...base, premium: true, state: "trial", endsAt: sub.trialEndsAt };
  }
  return { ...base, premium: false, state: "free", endsAt: null };
}

async function loadOrStartSubscription(groupId: string): Promise<SubscriptionRow> {
  const existing = await findSubscription(groupId);
  if (existing) return existing;
  const created = await createTrialIfMissing(groupId, Date.now() + billingConfig().trialDays * DAY);
  invalidateScopes([`group:${groupId}`]);
  return created;
}

export async function getEntitlementForGroup(groupId: string): Promise<Entitlement> {
  if (!billingConfig().enabled) return { billingEnabled: false, premium: true, state: "active", endsAt: null };
  return describeAccess(await loadOrStartSubscription(groupId));
}

export async function isPremiumUser(userId: string): Promise<boolean> {
  if (!billingConfig().enabled) return true;
  const user = await findUserById(userId);
  if (!user?.groupId) return false;
  return (await getEntitlementForGroup(user.groupId)).premium;
}

// ---------------------------------------------------------------------------
// Tela "Plano"
// ---------------------------------------------------------------------------

export async function getBillingForUser(userId: string) {
  const config = billingConfig();
  const groupId = await requireGroupId(userId);
  const sub = config.enabled ? await loadOrStartSubscription(groupId) : null;
  const entitlement = config.enabled ? describeAccess(sub) : await getEntitlementForGroup(groupId);
  const lastPaymentAt = sub?.lastPaymentAt ?? null;
  return {
    entitlement,
    prices: { monthly: config.priceMonthly, yearly: config.priceYearly },
    trialDays: config.trialDays,
    termsVersion: TERMS_VERSION,
    subscription: sub && {
      status: sub.status,
      plan: sub.plan,
      currentPeriodEnd: sub.currentPeriodEnd,
      pendingInvoiceUrl: sub.pendingInvoiceUrl,
      payerName: sub.payerName,
      isPayer: sub.payerUserId === userId,
      canRefund: sub.status === "active" && lastPaymentAt !== null && Date.now() - lastPaymentAt < REFUND_WINDOW_MS,
    },
  };
}

function todayInBrazil(now = Date.now()): string {
  return new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function startCheckout(
  userId: string,
  input: { plan: unknown; cpfCnpj: unknown; acceptTerms: unknown; termsVersion: unknown }
): Promise<{ invoiceUrl: string }> {
  const config = billingConfig();
  if (!config.enabled) throw new BillingError("A cobrança ainda não está ligada.");
  const plan: Plan = input.plan === "yearly" ? "yearly" : "monthly";
  if (input.acceptTerms !== true || input.termsVersion !== TERMS_VERSION) {
    throw new BillingError("Pra assinar, aceite os Termos de Uso e a Política de Privacidade.");
  }
  const document = typeof input.cpfCnpj === "string" ? onlyDigits(input.cpfCnpj) : "";
  if (!isValidCpfCnpj(document)) throw new BillingError("CPF ou CNPJ inválido. Confira os números.");

  const user = await findUserById(userId);
  if (!user?.groupId) throw new BillingError("Crie ou entre num grupo antes de assinar.");
  const sub = await loadOrStartSubscription(user.groupId);
  const access = describeAccess(sub);
  if (access.state === "active" || access.state === "courtesy" || access.state === "past_due") {
    throw new BillingError("O grupo já tem o Premium.", 409);
  }

  // Assinatura antiga sem pagamento (desistiu no meio): cancela antes de criar
  // outra, pra não chegar cobrança duplicada.
  if (sub.asaasSubscriptionId && sub.status !== "active") {
    await asaas.deleteSubscription(sub.asaasSubscriptionId).catch(() => {});
  }

  const customerId =
    sub.asaasCustomerId && sub.payerUserId === userId
      ? sub.asaasCustomerId
      : (await asaas.createCustomer({ name: user.displayName || user.email, email: user.email, cpfCnpj: document, userId })).id;

  // Quem está no teste só paga quando ele acaba (dá pra pagar antes, na mesma página).
  const firstDue = access.state === "trial" && access.endsAt ? todayInBrazil(access.endsAt) : todayInBrazil();
  const subscription = await asaas.createSubscription({
    customerId,
    plan,
    value: priceFor(plan),
    nextDueDate: firstDue,
    groupId: user.groupId,
  });
  const payments = await asaas.listSubscriptionPayments(subscription.id);
  const invoiceUrl = payments.data[0]?.invoiceUrl;
  if (!invoiceUrl) throw new BillingError("O Asaas não devolveu a página de pagamento. Tente de novo.", 502);

  await updateSubscription(user.groupId, {
    // Continua no teste até pagar; quem não está mais no teste fica "aguardando pagamento".
    status: sub.status === "trialing" ? "trialing" : "pending",
    plan,
    asaasCustomerId: customerId,
    asaasSubscriptionId: subscription.id,
    pendingInvoiceUrl: invoiceUrl,
    payerUserId: userId,
    payerName: user.displayName || user.email,
    termsVersion: TERMS_VERSION,
    termsAcceptedAt: Date.now(),
    canceledAt: null,
  });
  return { invoiceUrl };
}

// Cancela a renovação. O que já foi pago continua valendo até o fim do
// período. Dentro de 7 dias do pagamento dá pra pedir o dinheiro de volta
// (direito de arrependimento) -- aí o Premium acaba na hora.
export async function cancelSubscription(userId: string, input: { refund?: unknown }): Promise<void> {
  const user = await findUserById(userId);
  if (!user?.groupId) throw new BillingError("Você não está num grupo.");
  const sub = await findSubscription(user.groupId);
  if (!sub?.asaasSubscriptionId || sub.status === "canceled") throw new BillingError("Não há assinatura pra cancelar.");
  if (sub.payerUserId !== userId) {
    throw new BillingError(`Só quem assinou (${sub.payerName ?? "a outra pessoa"}) pode cancelar.`, 403);
  }
  const wantsRefund = input.refund === true;
  const canRefund = sub.lastPaymentId !== null && sub.lastPaymentAt !== null && Date.now() - sub.lastPaymentAt < REFUND_WINDOW_MS;
  if (wantsRefund && !canRefund) throw new BillingError("O prazo de 7 dias pro reembolso já passou.");

  await asaas.deleteSubscription(sub.asaasSubscriptionId).catch((err) => {
    if (!(err instanceof asaas.AsaasError && err.status === 404)) throw err;
  });
  if (wantsRefund && sub.lastPaymentId) await asaas.refundPayment(sub.lastPaymentId);

  await updateSubscription(user.groupId, {
    status: "canceled",
    canceledAt: Date.now(),
    pendingInvoiceUrl: null,
    ...(wantsRefund ? { currentPeriodEnd: Date.now() } : {}),
  });
  void sendOwnerEmail(
    `Assinatura cancelada${wantsRefund ? " com reembolso" : ""} no PAR.`,
    `<p>${escapeHtml(user.displayName || user.email)} cancelou o Premium${wantsRefund ? " e pediu reembolso (direito de arrependimento)" : ""}.</p>`
  );
}

// ---------------------------------------------------------------------------
// Webhook do Asaas
// ---------------------------------------------------------------------------

function periodEnd(dueDate: string, plan: Plan | null): number {
  const [y, m, d] = dueDate.split("-").map(Number);
  // Meia-noite em Brasília (03:00 UTC) do mesmo dia no mês/ano seguinte.
  return plan === "yearly" ? Date.UTC(y + 1, m - 1, d, 3) : Date.UTC(y, m, d, 3);
}

export interface AsaasWebhook {
  id?: string;
  event?: string;
  payment?: asaas.AsaasPayment;
  subscription?: { id: string; externalReference?: string };
}

export async function handleAsaasWebhook(body: AsaasWebhook): Promise<{ applied: boolean }> {
  const event = body.event ?? "";
  const payment = body.payment;
  const subscriptionId = payment?.subscription ?? body.subscription?.id;
  if (!subscriptionId) return { applied: false };

  const sub = await findSubscriptionByAsaasId(subscriptionId);
  if (!sub) return { applied: false };

  const eventKey = body.id ?? `${event}:${payment?.id ?? subscriptionId}`;
  const fresh = await recordEventOnce(eventKey, {
    event,
    groupId: sub.groupId,
    paymentId: payment?.id ?? null,
    value: payment?.value ?? null,
  });
  if (!fresh) return { applied: false };

  switch (event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED": {
      if (!payment) break;
      const end = periodEnd(payment.dueDate, sub.plan);
      // Pagamento de um período mais antigo chegando atrasado não encurta o atual.
      const currentPeriodEnd = Math.max(end, sub.currentPeriodEnd ?? 0);
      await updateSubscription(sub.groupId, {
        status: sub.status === "canceled" ? "canceled" : "active",
        currentPeriodEnd,
        pendingInvoiceUrl: null,
        lastPaymentId: payment.id,
        lastPaymentAt: Date.now(),
      });
      if (sub.status !== "active") {
        void sendOwnerEmail(
          "Nova assinatura no PAR.",
          `<p>${escapeHtml(sub.payerName ?? "Alguém")} assinou o Premium (${sub.plan === "yearly" ? "anual" : "mensal"}) — R$ ${payment.value.toFixed(2)}.</p>`
        );
      }
      break;
    }
    case "PAYMENT_OVERDUE":
      if (sub.status === "active") await updateSubscription(sub.groupId, { status: "past_due", pendingInvoiceUrl: payment?.invoiceUrl ?? null });
      break;
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
      await updateSubscription(sub.groupId, { status: "canceled", currentPeriodEnd: Date.now(), canceledAt: Date.now() });
      break;
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      await updateSubscription(sub.groupId, { status: "canceled", canceledAt: sub.canceledAt ?? Date.now(), pendingInvoiceUrl: null });
      break;
    default:
      return { applied: false };
  }
  invalidateScopes([`group:${sub.groupId}`]);
  return { applied: true };
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function getBillingAdminOverview() {
  const config = billingConfig();
  const [subs, events, actions] = await Promise.all([listSubscriptions(), listRecentEvents(), listAdminActions()]);
  const now = Date.now();
  const rows = await Promise.all(
    subs.map(async (sub) => {
      const members = await findMembersByGroupId(sub.groupId).catch(() => []);
      return {
        groupId: sub.groupId,
        members: members.map((m) => m.displayName),
        access: describeAccess(sub, now),
        status: sub.status,
        plan: sub.plan,
        payerName: sub.payerName,
        courtesyNote: sub.courtesyNote,
        updatedAt: sub.updatedAt,
      };
    })
  );
  const count = (state: AccessState) => rows.filter((r) => r.access.state === state).length;
  const paying = rows.filter((r) => ["active", "past_due", "canceled_active"].includes(r.access.state) && r.status !== "canceled");
  const mrr = paying.reduce((sum, r) => sum + (r.plan === "yearly" ? config.priceYearly / 12 : config.priceMonthly), 0);
  return {
    config: {
      enabled: config.enabled,
      asaasConfigured: config.asaasApiKey !== "",
      asaasEnv: config.asaasEnv,
      webhookConfigured: config.webhookToken !== "",
      prices: { monthly: config.priceMonthly, yearly: config.priceYearly },
      trialDays: config.trialDays,
    },
    totals: {
      active: count("active"),
      pastDue: count("past_due"),
      canceledActive: count("canceled_active"),
      trial: count("trial"),
      courtesy: count("courtesy"),
      free: count("free"),
      mrr: Math.round(mrr * 100) / 100,
    },
    groups: rows,
    events,
    actions,
  };
}

export async function grantCourtesy(adminEmail: string, input: { groupId: unknown; days: unknown; note: unknown }) {
  const groupId = typeof input.groupId === "string" ? input.groupId : "";
  const existing = groupId ? await findSubscription(groupId) : null;
  if (!existing) throw new BillingError("Grupo não encontrado na lista de assinaturas.", 404);
  const days = typeof input.days === "number" && input.days > 0 ? Math.min(input.days, 3650) : null;
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 120) : "";
  await updateSubscription(groupId, {
    courtesyUntil: days === null ? "forever" : Date.now() + days * DAY,
    courtesyNote: note || null,
  });
  await recordAdminAction({ adminEmail, action: "grant_courtesy", groupId, detail: days === null ? "pra sempre" : `${days} dias${note ? ` · ${note}` : ""}` });
  invalidateScopes([`group:${groupId}`]);
}

export async function revokeCourtesy(adminEmail: string, input: { groupId: unknown }) {
  const groupId = typeof input.groupId === "string" ? input.groupId : "";
  if (!groupId || !(await findSubscription(groupId))) throw new BillingError("Grupo não encontrado.", 404);
  await updateSubscription(groupId, { courtesyUntil: null, courtesyNote: null });
  await recordAdminAction({ adminEmail, action: "revoke_courtesy", groupId, detail: "" });
  invalidateScopes([`group:${groupId}`]);
}
