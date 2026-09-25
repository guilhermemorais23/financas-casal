import { afterEach, describe, expect, it } from "vitest";
import { auth, db } from "../../db/firestore";
import { createTestGroup } from "../../test-helpers";
import { getFirestoreUsage, installFirestoreUsageCounter } from "../../utils/firestoreUsage";
import { clearAppSettingsCache, getAppSettings, isBillingEnabled, updateAppSettings } from "../settings/appSettings";
import { getAdminInsights } from "./admin.insights";
import { getUserDetailForAdmin, listUsersForAdmin, setUserBlocked } from "./admin.users";

afterEach(async () => {
  await db.collection("appSettings").doc("global").delete();
  clearAppSettingsCache();
  delete process.env.BILLING_ENABLED;
});

describe("chaves do app", () => {
  it("cobrança: vale a variável do Render até o admin mexer no botão", async () => {
    clearAppSettingsCache();
    expect(await isBillingEnabled()).toBe(false);
    process.env.BILLING_ENABLED = "true";
    expect(await isBillingEnabled()).toBe(true);
    await updateAppSettings({ billingEnabled: false });
    expect(await isBillingEnabled()).toBe(false);
  });

  it("modo manutenção guarda a mensagem", async () => {
    await updateAppSettings({ maintenance: { enabled: true, message: "Voltamos às 23h" } });
    clearAppSettingsCache();
    expect((await getAppSettings()).maintenance).toEqual({ enabled: true, message: "Voltamos às 23h" });
  });
});

describe("Admin > Usuários", () => {
  it("acha pelo nome/email, mostra o detalhe e bloqueia/desbloqueia o login", async () => {
    const g = await createTestGroup();
    const email = `bloq-${Date.now()}@test.com`;
    await auth.createUser({ uid: g.userBId, email });
    await db.collection("users").doc(g.userBId).update({ email, displayName: "Beatriz Teste" });

    const found = await listUsersForAdmin("beatriz teste");
    expect(found.map((u) => u.id)).toContain(g.userBId);

    const detail = await getUserDetailForAdmin(g.userBId);
    expect(detail.group?.members.map((m) => m.id).sort()).toEqual([g.userAId, g.userBId].sort());

    await setUserBlocked("admin@test.com", g.userBId, true);
    expect((await auth.getUser(g.userBId)).disabled).toBe(true);
    expect((await getUserDetailForAdmin(g.userBId)).blocked).toBe(true);

    await setUserBlocked("admin@test.com", g.userBId, false);
    expect((await auth.getUser(g.userBId)).disabled).toBe(false);
  });
});

describe("Admin > números", () => {
  it("conta ativos e o funil", async () => {
    const g = await createTestGroup();
    await db.collection("users").doc(g.userAId).update({ lastSeenAt: Date.now() });
    const insights = await getAdminInsights();
    expect(insights.activity.today).toBeGreaterThanOrEqual(1);
    expect(insights.funnel.inPairedGroup).toBeGreaterThanOrEqual(2);
    expect(insights.funnel.payingGroups).toBeNull(); // cobrança desligada
  });

  it("contador de leituras do Firestore soma o que foi lido", async () => {
    installFirestoreUsageCounter();
    const before = getFirestoreUsage().reads;
    await db.collection("users").limit(3).get();
    expect(getFirestoreUsage().reads).toBeGreaterThan(before);
  });
});
