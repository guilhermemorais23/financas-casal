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
