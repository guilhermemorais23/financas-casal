import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { createAnnouncement, listPendingFor, markAnnouncementSeen, setActive } from "./announcements.service";

describe("pop-ups de novidade", () => {
  it("pra todos: aparece uma vez pra cada pessoa e some depois de visto", async () => {
    const { userAId, userBId } = await createTestGroup();
    const created = await createAnnouncement(
      { title: "Fechamento do mês", text: "Todo dia 1 chega o resumo do mês.", bullets: ["Entrou e saiu", "", "Onde mais foi"] },
      "admin@test.com"
    );
    expect(created.bullets).toEqual(["Entrou e saiu", "Onde mais foi"]);

    expect((await listPendingFor(userAId)).map((a) => a.id)).toContain(created.id);
    expect((await listPendingFor(userBId)).map((a) => a.id)).toContain(created.id);

    await markAnnouncementSeen(created.id, userAId);
    await markAnnouncementSeen(created.id, userAId);
    expect((await listPendingFor(userAId)).map((a) => a.id)).not.toContain(created.id);
    expect((await listPendingFor(userBId)).map((a) => a.id)).toContain(created.id);

    await setActive(created.id, false);
    expect((await listPendingFor(userBId)).map((a) => a.id)).not.toContain(created.id);
  });

  it("pra uma pessoa: só ela vê", async () => {
    const { userAId, userBId } = await createTestGroup();
    const created = await createAnnouncement(
      { title: "Oi, A", text: "Arrumamos o seu cartão.", audience: "user", targetUserId: userAId, ctaLabel: "Ver cartões", ctaPath: "/cards" },
      "admin@test.com"
    );
    expect(created).toMatchObject({ audience: "user", targetUserId: userAId, targetName: "A", ctaPath: "/cards" });
    expect((await listPendingFor(userAId)).map((a) => a.id)).toContain(created.id);
    expect((await listPendingFor(userBId)).map((a) => a.id)).not.toContain(created.id);
  });

  it("recusa link pra fora do app e pessoa que não existe", async () => {
    await expect(
      createAnnouncement({ title: "Oi", text: "Texto", ctaLabel: "Abrir", ctaPath: "https://exemplo.com" }, "admin@test.com")
    ).rejects.toThrow("tela do app");
    await expect(
      createAnnouncement({ title: "Oi", text: "Texto", audience: "user", targetUserId: "ninguem" }, "admin@test.com")
    ).rejects.toThrow("pra quem vai");
  });
});

describe("pop-ups por público e cliques", () => {
  it("casais, sozinhos e contas novas: cada um vê o seu", async () => {
    const { userAId } = await createTestGroup();
    const { db } = await import("../../db/firestore");
    const { upsertUserProfile } = await import("../users/users.repository");
    const soloId = `solo-${Date.now()}`;
    await upsertUserProfile({ id: soloId, email: `${soloId}@par.dev`, displayName: "Solo" });
    // Conta "antiga" pra ela existir antes dos pop-ups.
    await db.collection("users").doc(soloId).update({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) });
    await db.collection("users").doc(userAId).update({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) });

    const couples = await createAnnouncement({ title: "Pro casal", text: "Texto", audience: "couples" }, "admin@test.com");
    const solo = await createAnnouncement({ title: "Chame seu par", text: "Texto", audience: "solo" }, "admin@test.com");
    const fresh = await createAnnouncement({ title: "Comece por aqui", text: "Texto", audience: "new" }, "admin@test.com");

    const forCouple = (await listPendingFor(userAId)).map((a) => a.id);
    const forSolo = (await listPendingFor(soloId)).map((a) => a.id);
    expect(forCouple).toContain(couples.id);
    expect(forCouple).not.toContain(solo.id);
    expect(forSolo).toContain(solo.id);
    expect(forSolo).not.toContain(couples.id);
    // As duas contas têm 60 dias: não são novas.
    expect(forCouple).not.toContain(fresh.id);

    const newId = `novo-${Date.now()}`;
    await upsertUserProfile({ id: newId, email: `${newId}@par.dev`, displayName: "Nova" });
    expect((await listPendingFor(newId)).map((a) => a.id)).toContain(fresh.id);
    for (const a of [couples, solo, fresh]) await setActive(a.id, false);
  });

  it("conta quem viu e quem tocou no botão, uma vez por pessoa", async () => {
    const { userAId, userBId } = await createTestGroup();
    const { findAnnouncement } = await import("./announcements.repository");
    const a = await createAnnouncement({ title: "Veja", text: "Texto", ctaLabel: "Abrir", ctaPath: "/goals" }, "admin@test.com");
    await markAnnouncementSeen(a.id, userAId, true);
    await markAnnouncementSeen(a.id, userAId, true);
    await markAnnouncementSeen(a.id, userBId);
    await markAnnouncementSeen(a.id, userBId, true);
    const after = await findAnnouncement(a.id);
    expect(after).toMatchObject({ seenCount: 2, clickCount: 2 });
    await setActive(a.id, false);
  });
});
