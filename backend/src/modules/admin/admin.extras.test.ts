import { afterEach, describe, expect, it } from "vitest";
import { auth, db } from "../../db/firestore";
import { createTestGroup } from "../../test-helpers";
import { getFirestoreUsage, installFirestoreUsageCounter } from "../../utils/firestoreUsage";
import { clearAppSettingsCache, getAppSettings, isBillingEnabled, updateAppSettings } from "../settings/appSettings";
import { getAdminInsights } from "./admin.insights";
import { AdminUserError, deleteUserForAdmin, getUserDetailForAdmin, listUsersForAdmin, sendPasswordResetForAdmin, setUserBlocked } from "./admin.users";

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

describe("Admin > Usuários: senha e excluir a pedido", () => {
  it("só exclui com o email da pessoa digitado, e apaga login e perfil", async () => {
    const g = await createTestGroup();
    const email = `apagar-${Date.now()}@test.com`;
    await auth.createUser({ uid: g.userBId, email });
    await db.collection("users").doc(g.userBId).update({ email });

    await expect(deleteUserForAdmin("admin@test.com", g.userBId, "outro@test.com")).rejects.toBeInstanceOf(AdminUserError);
    expect((await db.collection("users").doc(g.userBId).get()).exists).toBe(true);

    await deleteUserForAdmin("admin@test.com", g.userBId, email.toUpperCase());
    expect((await db.collection("users").doc(g.userBId).get()).exists).toBe(false);
    await expect(auth.getUser(g.userBId)).rejects.toThrow();
  });

  it("não manda email de senha sem provedor de email configurado (avisa o admin)", async () => {
    const g = await createTestGroup();
    const email = `senha-${Date.now()}@test.com`;
    await auth.createUser({ uid: g.userAId, email, password: "senha-antiga-123" });
    await db.collection("users").doc(g.userAId).update({ email });
    const saved = { brevo: process.env.BREVO_API_KEY, gmail: process.env.GMAIL_USER };
    delete process.env.BREVO_API_KEY;
    delete process.env.GMAIL_USER;
    try {
      await expect(sendPasswordResetForAdmin("admin@test.com", g.userAId)).rejects.toMatchObject({ status: 502 });
    } finally {
      if (saved.brevo) process.env.BREVO_API_KEY = saved.brevo;
      if (saved.gmail) process.env.GMAIL_USER = saved.gmail;
    }
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
