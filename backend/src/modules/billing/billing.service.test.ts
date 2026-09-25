import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestGroup } from "../../test-helpers";
import * as asaas from "./asaas.client";
import { TERMS_VERSION } from "./billing.config";
import { updateSubscription, createTrialIfMissing, findSubscription } from "./billing.repository";
import {
  cancelSubscription,
  describeAccess,
  getEntitlementForGroup,
  grantCourtesy,
  handleAsaasWebhook,
  isPremiumUser,
  startCheckout,
} from "./billing.service";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  process.env.BILLING_ENABLED = "true";
  process.env.ASAAS_API_KEY = "test-key";
});
afterEach(() => {
  delete process.env.BILLING_ENABLED;
  delete process.env.ASAAS_API_KEY;
  vi.restoreAllMocks();
});

async function groupWithAsaasSub(subId: string) {
  const g = await createTestGroup();
  await createTrialIfMissing(g.groupId, Date.now() - DAY); // teste já acabou
  await updateSubscription(g.groupId, { asaasSubscriptionId: subId, plan: "monthly", status: "pending", payerUserId: g.userAId });
  return g;
}

describe("quem tem Premium", () => {
  it("com a cobrança desligada, todo mundo tem tudo e nada é gravado", async () => {
    delete process.env.BILLING_ENABLED;
    const g = await createTestGroup();
    expect((await getEntitlementForGroup(g.groupId)).premium).toBe(true);
    expect(await findSubscription(g.groupId)).toBeNull();
  });

  it("grupo novo ganha o período de teste uma vez só", async () => {
    const g = await createTestGroup();
    const first = await getEntitlementForGroup(g.groupId);
    expect(first).toMatchObject({ premium: true, state: "trial" });
    const again = await getEntitlementForGroup(g.groupId);
    expect(again.endsAt).toBe(first.endsAt);
  });

  it("estados a partir das datas", () => {
    const now = Date.now();
    const base = { status: "active", trialEndsAt: 0, courtesyUntil: null, currentPeriodEnd: now + DAY } as never;
    expect(describeAccess({ ...(base as object), currentPeriodEnd: now + DAY } as never, now).state).toBe("active");
    // venceu ontem: ainda tem os dias de tolerância
    expect(describeAccess({ ...(base as object), status: "past_due", currentPeriodEnd: now - DAY } as never, now).state).toBe("past_due");
    // venceu há 5 dias: acabou
    expect(describeAccess({ ...(base as object), status: "past_due", currentPeriodEnd: now - 5 * DAY } as never, now).premium).toBe(false);
    // cancelou mas o mês pago ainda não acabou
    expect(describeAccess({ ...(base as object), status: "canceled" } as never, now).state).toBe("canceled_active");
    expect(describeAccess({ ...(base as object), status: "canceled", currentPeriodEnd: null, courtesyUntil: "forever" } as never, now).state).toBe("courtesy");
  });
});

describe("webhook do Asaas", () => {
  it("pagamento confirmado libera o Premium; evento repetido não conta de novo", async () => {
    const g = await groupWithAsaasSub("sub_ok_" + Date.now());
    const sub = (await findSubscription(g.groupId))!;
    expect(await isPremiumUser(g.userAId)).toBe(false);

    const body = { id: "evt_" + Date.now(), event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", status: "CONFIRMED", value: 14.9, dueDate: "2026-09-25", subscription: sub.asaasSubscriptionId! } };
    expect(await handleAsaasWebhook(body)).toEqual({ applied: true });
    expect(await handleAsaasWebhook(body)).toEqual({ applied: false });

    const after = (await findSubscription(g.groupId))!;
    expect(after.status).toBe("active");
    expect(new Date(after.currentPeriodEnd!).toISOString().slice(0, 10)).toBe("2026-10-25");
  });

  it("atraso e depois estorno", async () => {
    const g = await groupWithAsaasSub("sub_late_" + Date.now());
    const subId = (await findSubscription(g.groupId))!.asaasSubscriptionId!;
    const due = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await handleAsaasWebhook({ id: "a" + Date.now(), event: "PAYMENT_CONFIRMED", payment: { id: "p1", status: "CONFIRMED", value: 14.9, dueDate: due, subscription: subId } });
    await handleAsaasWebhook({ id: "b" + Date.now(), event: "PAYMENT_OVERDUE", payment: { id: "p2", status: "OVERDUE", value: 14.9, dueDate: due, subscription: subId } });
    expect((await findSubscription(g.groupId))!.status).toBe("past_due");
    await handleAsaasWebhook({ id: "c" + Date.now(), event: "PAYMENT_REFUNDED", payment: { id: "p1", status: "REFUNDED", value: 14.9, dueDate: due, subscription: subId } });
    expect(await isPremiumUser(g.userAId)).toBe(false);
  });
});

describe("assinar e cancelar", () => {
  it("recusa sem aceitar os termos ou com CPF inválido", async () => {
    const g = await createTestGroup();
    await expect(startCheckout(g.userAId, { plan: "monthly", cpfCnpj: "52998224725", acceptTerms: false, termsVersion: TERMS_VERSION })).rejects.toThrow("Termos");
    await expect(startCheckout(g.userAId, { plan: "monthly", cpfCnpj: "123", acceptTerms: true, termsVersion: TERMS_VERSION })).rejects.toThrow("CPF");
  });

  it("cria a assinatura no Asaas e devolve a página de pagamento; só quem assinou cancela", async () => {
    const g = await createTestGroup();
    const subId = "sub_new_" + Date.now();
    vi.spyOn(asaas, "createCustomer").mockResolvedValue({ id: "cus_1" });
    const create = vi.spyOn(asaas, "createSubscription").mockResolvedValue({ id: subId });
    vi.spyOn(asaas, "listSubscriptionPayments").mockResolvedValue({ data: [{ id: "pay_x", status: "PENDING", value: 149, dueDate: "2026-10-09", invoiceUrl: "https://asaas/i/1" }] });
    const del = vi.spyOn(asaas, "deleteSubscription").mockResolvedValue({ deleted: true });

    const out = await startCheckout(g.userAId, { plan: "yearly", cpfCnpj: "529.982.247-25", acceptTerms: true, termsVersion: TERMS_VERSION });
    expect(out.invoiceUrl).toBe("https://asaas/i/1");
    expect(create.mock.calls[0][0]).toMatchObject({ plan: "yearly", value: 149, groupId: g.groupId });
    const saved = (await findSubscription(g.groupId))!;
    expect(saved).toMatchObject({ asaasSubscriptionId: subId, payerUserId: g.userAId, termsVersion: TERMS_VERSION });

    await expect(cancelSubscription(g.userBId, {})).rejects.toThrow("Só quem assinou");
    await cancelSubscription(g.userAId, {});
    expect(del).toHaveBeenCalledWith(subId);
    expect((await findSubscription(g.groupId))!.status).toBe("canceled");
  });

  it("cortesia do admin dá Premium", async () => {
    const g = await groupWithAsaasSub("sub_c_" + Date.now());
    expect(await isPremiumUser(g.userBId)).toBe(false);
    await grantCourtesy("admin@test.com", { groupId: g.groupId, days: 30, note: "testador" });
    expect(await isPremiumUser(g.userBId)).toBe(true);
  });
});
