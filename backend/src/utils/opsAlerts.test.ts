import { describe, expect, it, vi } from "vitest";
import * as mailer from "../email/mailer";
import { ERROR_BURST, alertOwnerOnce, checkTelegram, noteError } from "./opsAlerts";

describe("alertas pro dono", () => {
  it("manda cada aviso uma vez por janela", async () => {
    const spy = vi.spyOn(mailer, "sendOwnerEmail").mockResolvedValue({ ok: true, provider: "brevo" });
    const key = `teste-${Date.now()}`;
    const now = Date.now();
    expect(await alertOwnerOnce(key, 60_000, "Algo quebrou", "<p>x</p>", now)).toBe(true);
    expect(await alertOwnerOnce(key, 60_000, "Algo quebrou", "<p>x</p>", now + 1000)).toBe(false);
    expect(await alertOwnerOnce(key, 60_000, "Algo quebrou", "<p>x</p>", now + 61_000)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0]).toBe("[PAR. alerta] Algo quebrou");
    spy.mockRestore();
  });

  it("avisa quando os erros se acumulam, e não conta erro do próprio email", async () => {
    const spy = vi.spyOn(mailer, "sendOwnerEmail").mockResolvedValue({ ok: true, provider: "brevo" });
    const base = Date.now() + 10 * 60 * 60 * 1000; // longe de qualquer aviso anterior
    const err = (i: number, source = "api") => ({
      id: `t-${i}`,
      source,
      message: `falhou <b>${i}</b>`,
      stack: null,
      path: "/api/x",
      method: "GET",
      userId: null,
      createdAt: base + i,
    });
    for (let i = 0; i < ERROR_BURST.count * 2; i++) noteError(err(i, "email"), false);
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
    for (let i = 0; i < ERROR_BURST.count; i++) noteError(err(i), false);
    await new Promise((r) => setTimeout(r, 300));
    const burst = spy.mock.calls.filter(([subject]) => subject.includes("erros em"));
    expect(burst).toHaveLength(1);
    // Texto do erro entra escapado.
    expect(burst[0][1]).toContain("&lt;b&gt;");
    spy.mockRestore();
  });

  it("Telegram: acusa webhook sem endereço, erro recente e fila parada", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "123:abc";
    const now = Date.now();
    const reply = (result: object) => (async () => ({ status: 200, json: async () => ({ ok: true, result }) })) as unknown as typeof fetch;
    try {
      expect(await checkTelegram(now, reply({ url: "https://x/webhook", pending_update_count: 0 }))).toBeNull();
      expect(await checkTelegram(now, reply({ url: "", pending_update_count: 0 }))).toMatch(/não está configurado/);
      expect(
        await checkTelegram(now, reply({ url: "https://x", pending_update_count: 3, last_error_date: Math.floor(now / 1000) - 60, last_error_message: "Wrong response 401" }))
      ).toMatch(/401/);
      expect(await checkTelegram(now, reply({ url: "https://x", pending_update_count: 25 }))).toMatch(/25 mensagens/);
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
    expect(await checkTelegram(now)).toBeNull();
  });
});
