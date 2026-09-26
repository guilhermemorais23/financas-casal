import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { isValidMetaSignature, telegramWebhookHandler } from "./modules/assistant/assistant.controller";
import { isHeavyRequest } from "./app";

function fakeReq(headers: Record<string, string>, body: unknown, rawBody?: Buffer): Request {
  return { header: (name: string) => headers[name.toLowerCase()], body, rawBody, path: "/x", method: "POST" } as unknown as Request;
}

function fakeRes() {
  const res = { statusCode: 0, status(code: number) { res.statusCode = code; return res; }, end() { return res; } };
  return res as unknown as Response & { statusCode: number };
}

describe("webhook do WhatsApp: só aceita o que a Meta assinou", () => {
  afterEach(() => delete process.env.WHATSAPP_APP_SECRET);
  const raw = Buffer.from(JSON.stringify({ entry: [] }));

  it("aceita assinatura certa e recusa errada, ausente ou sem App Secret", () => {
    process.env.WHATSAPP_APP_SECRET = "segredo";
    const good = "sha256=" + createHmac("sha256", "segredo").update(raw).digest("hex");
    expect(isValidMetaSignature(fakeReq({ "x-hub-signature-256": good }, {}, raw))).toBe(true);
    expect(isValidMetaSignature(fakeReq({ "x-hub-signature-256": "sha256=" + "0".repeat(64) }, {}, raw))).toBe(false);
    expect(isValidMetaSignature(fakeReq({}, {}, raw))).toBe(false);
    // Corpo mexido depois de assinado.
    expect(isValidMetaSignature(fakeReq({ "x-hub-signature-256": good }, {}, Buffer.from("{}")))).toBe(false);
    delete process.env.WHATSAPP_APP_SECRET;
    expect(isValidMetaSignature(fakeReq({ "x-hub-signature-256": good }, {}, raw))).toBe(false);
  });
});

describe("webhook do Telegram: sem segredo configurado, recusa", () => {
  afterEach(() => delete process.env.TELEGRAM_WEBHOOK_SECRET);

  it("401 sem segredo no servidor, com segredo errado; passa com o certo", async () => {
    let res = fakeRes();
    await telegramWebhookHandler(fakeReq({}, {}), res);
    expect(res.statusCode).toBe(401);

    process.env.TELEGRAM_WEBHOOK_SECRET = "abc";
    res = fakeRes();
    await telegramWebhookHandler(fakeReq({ "x-telegram-bot-api-secret-token": "errado" }, {}), res);
    expect(res.statusCode).toBe(401);

    res = fakeRes();
    await telegramWebhookHandler(fakeReq({ "x-telegram-bot-api-secret-token": "abc" }, {}), res);
    expect(res.statusCode).toBe(200); // sem mensagem: responde 200 e não faz nada
  });
});

describe("limite apertado nas rotas caras ou adivinháveis", () => {
  it("PDF, chat, aceitar convite, mandar feedback e link público; o resto não", () => {
    expect(isHeavyRequest("POST", "/statements/preview")).toBe(true);
    expect(isHeavyRequest("POST", "/assistant/chat")).toBe(true);
    expect(isHeavyRequest("POST", "/groups/accept")).toBe(true);
    expect(isHeavyRequest("POST", "/feedback")).toBe(true);
    expect(isHeavyRequest("GET", "/public/shares/abc")).toBe(true);
    expect(isHeavyRequest("GET", "/feedback/unread")).toBe(false);
    expect(isHeavyRequest("GET", "/transactions")).toBe(false);
  });
});
