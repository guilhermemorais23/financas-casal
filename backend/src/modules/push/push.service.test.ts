import { afterEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { db } from "../../db/firestore";
import { InvalidSubscriptionError, countSubscriptions, htmlToText, removeSubscription, saveSubscription, sendPushToUser } from "./push.service";

const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/teste-${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notificação no celular", () => {
  it("guarda o endereço de cada aparelho, recusa endereço estranho e tira quando pede", async () => {
    const userId = `push-${Date.now()}`;
    await saveSubscription(userId, sub(1), "Chrome");
    await saveSubscription(userId, sub(1), "Chrome"); // mesmo aparelho de novo
    await saveSubscription(userId, sub(2), "Safari");
    expect(await countSubscriptions(userId)).toBe(2);

    await expect(saveSubscription(userId, { endpoint: "http://evil.test/x", keys: { p256dh: "p", auth: "a" } }, "")).rejects.toBeInstanceOf(InvalidSubscriptionError);
    await expect(saveSubscription(userId, { endpoint: "https://x.test/y" }, "")).rejects.toBeInstanceOf(InvalidSubscriptionError);

    // Outra pessoa não consegue apagar o aparelho de ninguém.
    await removeSubscription("outra-pessoa", sub(1).endpoint);
    expect(await countSubscriptions(userId)).toBe(2);
    await removeSubscription(userId, sub(1).endpoint);
    expect(await countSubscriptions(userId)).toBe(1);
  });

  it("manda pra todos os aparelhos e esquece o que o navegador jogou fora", async () => {
    process.env.VAPID_PUBLIC_KEY = "BNx2u0lV0iqk0FjH0Kc8h7K3oD8b3kR8pS2HqM1HlZ0XyQJq7lqHkq9y1Yb3dM2nq0vV6cJ3aT3nH4dG5qK1x0o";
    process.env.VAPID_PRIVATE_KEY = "3K1s2a8Yk2F0bq3L0mY2mZ7cQ9pG4nR5tV6wX8yZ0aA";
    vi.spyOn(webpush, "setVapidDetails").mockImplementation(() => undefined);
    const userId = `push2-${Date.now()}`;
    await saveSubscription(userId, sub(10), "");
    await saveSubscription(userId, sub(11), "");
    const send = vi.spyOn(webpush, "sendNotification").mockImplementation(async (s) => {
      if (s.endpoint.endsWith("teste-11")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      return { statusCode: 201, body: "", headers: {} };
    });
    try {
      const delivered = await sendPushToUser(userId, { title: "Fatura vence amanhã", body: "Nubank", url: "https://fora.test" });
      expect(delivered).toBe(1);
      const payload = JSON.parse(String(send.mock.calls[0][1]));
      // Link de fora nunca: vira o Painel.
      expect(payload.url).toBe("/dashboard");
      expect(await countSubscriptions(userId)).toBe(1);
    } finally {
      delete process.env.VAPID_PUBLIC_KEY;
      delete process.env.VAPID_PRIVATE_KEY;
      await db.collection("pushSubscriptions").where("userId", "==", userId).get().then((s) => Promise.all(s.docs.map((d) => d.ref.delete())));
    }
  });

  it("sem chaves VAPID não manda nada", async () => {
    expect(await sendPushToUser("ninguem", { title: "x", body: "y" })).toBe(0);
  });

  it("transforma o email em texto curto", () => {
    expect(htmlToText("<p>A fatura do <strong>Nubank</strong> vence &amp; já</p><p>Olhe</p>")).toBe("A fatura do Nubank vence & já Olhe");
  });
});
