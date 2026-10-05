import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { webhookHandler } from "./openFinance.controller";
import * as push from "../push/push.service";
import { createTestGroup } from "../../test-helpers";
import { setPluggyFetch, type PluggyTransaction } from "../../utils/pluggy";
import {
  OpenFinanceItemNotFoundError,
  OpenFinanceNotYoursError,
  OpenFinanceUnavailableError,
  canUseOpenFinance,
  createConnectToken,
  markBankSynced,
  pluggyWebhookUrl,
  previewFromBank,
  processPluggyEvent,
  registerItem,
  removeBankConnection,
  toStatementRows,
} from "./openFinance.service";
import { findItem } from "./openFinance.repository";

const ENV = ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET", "PLUGGY_ALLOWED_EMAILS", "ADMIN_EMAILS", "PLUGGY_WEBHOOK_SECRET", "API_PUBLIC_URL", "RENDER_EXTERNAL_URL"];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

// Pluggy de mentira: itens por id (com o clientUserId de quem conectou),
// uma conta corrente e um cartão, e as transações da conta.
const fake = {
  items: new Map<string, { clientUserId: string }>(),
  transactions: [] as PluggyTransaction[],
  deleted: [] as string[],
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function installFakePluggy() {
  setPluggyFetch(async (url, init) => {
    const path = new URL(url).pathname.slice(1);
    if (path === "auth") return json({ apiKey: "k" });
    if (path === "connect_token") return json({ accessToken: "token-" + JSON.parse(String(init?.body)).options.clientUserId });
    const item = path.match(/^items\/(.+)$/);
    if (item && init?.method === "DELETE") {
      fake.deleted.push(item[1]);
      return new Response(null, { status: 204 });
    }
    if (item) {
      const found = fake.items.get(item[1]);
      return found ? json({ id: item[1], clientUserId: found.clientUserId, status: "UPDATED", connector: { id: 1, name: "MeuPluggy" } }) : json({ message: "not found" }, 404);
    }
    if (path === "accounts")
      return json({
        results: [
          { id: "acc-1", type: "BANK", subtype: "CHECKING_ACCOUNT", name: "Conta", number: "12345-6" },
          { id: "card-1", type: "CREDIT", subtype: "CREDIT_CARD", name: "Cartão", number: "9999" },
        ],
      });
    if (path === "v2/transactions") return json({ results: fake.transactions, next: null });
    return json({ message: "?" }, 404);
  });
}

describe("Conectar conta (Pluggy)", () => {
  beforeEach(() => {
    process.env.PLUGGY_CLIENT_ID = "id";
    process.env.PLUGGY_CLIENT_SECRET = "secret";
    process.env.ADMIN_EMAILS = "dono@test.com";
    delete process.env.PLUGGY_ALLOWED_EMAILS;
    fake.items.clear();
    fake.transactions = [];
    fake.deleted = [];
    installFakePluggy();
  });
  afterEach(() => {
    setPluggyFetch(null);
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("só libera com as chaves e pra quem pode (admins ou a lista PLUGGY_ALLOWED_EMAILS)", async () => {
    expect(canUseOpenFinance("dono@test.com")).toBe(true);
    expect(canUseOpenFinance("outra@test.com")).toBe(false);
    process.env.PLUGGY_ALLOWED_EMAILS = "outra@test.com";
    expect(canUseOpenFinance("outra@test.com")).toBe(true);
    expect(canUseOpenFinance("dono@test.com")).toBe(false);
    delete process.env.PLUGGY_CLIENT_SECRET;
    expect(canUseOpenFinance("outra@test.com")).toBe(false);
    await expect(createConnectToken("u", "outra@test.com")).rejects.toBeInstanceOf(OpenFinanceUnavailableError);
  });

  it("o token de conexão leva o id da pessoa e ninguém registra a conexão de outra", async () => {
    const { userAId, userBId } = await createTestGroup();
    expect(await createConnectToken(userAId, "dono@test.com")).toEqual({ accessToken: `token-${userAId}` });

    fake.items.set("item-a", { clientUserId: userAId });
    await expect(registerItem(userBId, "dono@test.com", "item-a")).rejects.toBeInstanceOf(OpenFinanceNotYoursError);
    expect(await registerItem(userAId, "dono@test.com", "item-a")).toEqual({ itemId: "item-a", connectorName: "MeuPluggy" });
    expect((await findItem("item-a"))?.userId).toBe(userAId);

    // Outra pessoa não lê, não marca e não apaga a conexão de A.
    await expect(previewFromBank(userBId, "dono@test.com", "item-a", "acc-1")).rejects.toBeInstanceOf(OpenFinanceItemNotFoundError);
    await expect(markBankSynced(userBId, "dono@test.com", "item-a", "acc-1", "2026-09-01")).rejects.toBeInstanceOf(OpenFinanceItemNotFoundError);
    await expect(removeBankConnection(userBId, "dono@test.com", "item-a")).rejects.toBeInstanceOf(OpenFinanceItemNotFoundError);
    expect(fake.deleted).toEqual([]);

    await removeBankConnection(userAId, "dono@test.com", "item-a");
    expect(fake.deleted).toEqual(["item-a"]);
    expect(await findItem("item-a")).toBeNull();
  });

  it("converte as transações: sinal, nome da loja/pessoa, pendente e crédito do cartão", () => {
    const tx = (over: Partial<PluggyTransaction>): PluggyTransaction => ({
      id: Math.random().toString(),
      accountId: "acc-1",
      date: "2026-09-12T03:00:00.000Z",
      description: "PIX ENVIADO",
      type: "DEBIT",
      amount: -50,
      ...over,
    });
    const rows = toStatementRows(
      [
        tx({ paymentData: { receiver: { name: "Maria Silva" } } }),
        tx({ type: "CREDIT", amount: 1000, description: "PIX RECEBIDO", paymentData: { payer: { name: "Empresa X" } } }),
        tx({ description: "Compra", merchant: { name: "Padaria Sol" } }),
        tx({ status: "PENDING" }),
        tx({ description: "TARIFA" }),
      ],
      { type: "BANK" }
    );
    expect(rows.map((r) => [r.date, r.description, r.kind, r.amountCents])).toEqual([
      ["2026-09-12", "Maria Silva", "PIX ENVIADO", -5000],
      ["2026-09-12", "Empresa X", "PIX RECEBIDO", 100000],
      ["2026-09-12", "Padaria Sol", "Compra", -5000],
      ["2026-09-12", "TARIFA", null, -5000],
    ]);
    // Cartão: pagamento da fatura/estorno (CREDIT) fica de fora.
    expect(toStatementRows([tx({ type: "CREDIT", amount: 300, description: "Pagamento recebido" })], { type: "CREDIT" })).toEqual([]);
  });

  it("puxa do banco e entrega a mesma revisão da importação, com entrada continuando entrada", async () => {
    const { userAId } = await createTestGroup();
    fake.items.set("item-b", { clientUserId: userAId });
    await registerItem(userAId, "dono@test.com", "item-b");
    fake.transactions = [
      { id: "t1", accountId: "acc-1", date: "2026-09-10T03:00:00.000Z", description: "PIX RECEBIDO", type: "CREDIT", amount: 3000, paymentData: { payer: { name: "Empresa X" } } },
      { id: "t2", accountId: "acc-1", date: "2026-09-11T03:00:00.000Z", description: "PIX RECEBIDO", type: "CREDIT", amount: 3000, paymentData: { payer: { name: "Empresa X" } } },
    ];
    const result = await previewFromBank(userAId, "dono@test.com", "item-b", "acc-1");
    expect(result.format).toBe("bank");
    expect(result.assumedAllExpenses).toBe(false);
    expect(result.groups).toMatchObject([{ key: "empresa x", transactionType: "income", count: 2, total: "6000.00", kind: "PIX RECEBIDO" }]);
    expect(result.source).toMatchObject({ itemId: "item-b", accountId: "acc-1" });

    await markBankSynced(userAId, "dono@test.com", "item-b", "acc-1", "2026-09-26");
    expect((await findItem("item-b"))?.syncedUntil).toEqual({ "acc-1": "2026-09-26" });
  });

  it("aviso do Pluggy: conta o que falta importar, notifica uma vez e zera ao importar", async () => {
    const { userAId } = await createTestGroup();
    fake.items.set("item-w", { clientUserId: userAId });
    await registerItem(userAId, "dono@test.com", "item-w");
    await markBankSynced(userAId, "dono@test.com", "item-w", "acc-1", "2026-09-10");
    fake.transactions = [
      { id: "a", accountId: "acc-1", date: "2026-09-09T03:00:00.000Z", description: "Antigo", type: "DEBIT", amount: 10 },
      { id: "b", accountId: "acc-1", date: "2026-09-12T03:00:00.000Z", description: "Mercado", type: "DEBIT", amount: 50 },
      { id: "c", accountId: "acc-1", date: "2026-09-13T03:00:00.000Z", description: "PIX", type: "CREDIT", amount: 80 },
    ];
    const sent = vi.spyOn(push, "sendPushToUser").mockResolvedValue(1);

    await processPluggyEvent({ event: "transactions/created", itemId: "item-w" });
    const after = await findItem("item-w");
    expect(after?.pending?.accounts["acc-1"]).toBe(2);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0]).toBe(userAId);
    expect(sent.mock.calls[0][1].url).toBe("/dashboard?importar=banco");

    // O mesmo aviso de novo, sem nada novo: não notifica outra vez.
    await processPluggyEvent({ event: "item/updated", itemId: "item-w" });
    const calls = sent.mock.calls.filter(([id]) => id === userAId).length;
    // (o cartão não conta crédito; os dois débitos/créditos da conta são os mesmos)
    expect(calls).toBe(1);

    // Evento estranho ou item de ninguém: ignora.
    await processPluggyEvent({ event: "item/deleted", itemId: "item-w" });
    await processPluggyEvent({ event: "transactions/created", itemId: "nao-existe" });
    expect(sent.mock.calls.filter(([id]) => id === userAId).length).toBe(1);

    await markBankSynced(userAId, "dono@test.com", "item-w", "acc-1", "2026-09-13");
    expect((await findItem("item-w"))?.pending?.accounts["acc-1"]).toBe(0);
    sent.mockRestore();
  });

  it("endereço do aviso só com https e segredo; a rota recusa sem o segredo certo", async () => {
    expect(pluggyWebhookUrl()).toBeNull();
    process.env.PLUGGY_WEBHOOK_SECRET = "s3gr3do";
    process.env.RENDER_EXTERNAL_URL = "http://inseguro.test";
    expect(pluggyWebhookUrl()).toBeNull();
    process.env.RENDER_EXTERNAL_URL = "https://par.onrender.com/";
    expect(pluggyWebhookUrl()).toBe("https://par.onrender.com/api/open-finance/webhook?token=s3gr3do");

    const call = async (token: string | undefined) => {
      const res = { statusCode: 0, status(code: number) { res.statusCode = code; return res; }, end() { return res; }, json() { return res; } };
      await webhookHandler({ query: token === undefined ? {} : { token }, body: { event: "item/updated", itemId: "nao-existe" } } as unknown as Request, res as unknown as Response);
      return res.statusCode;
    };
    expect(await call("errado")).toBe(403);
    expect(await call(undefined)).toBe(403);
    expect(await call("s3gr3do")).toBe(200);
    delete process.env.PLUGGY_WEBHOOK_SECRET;
    expect(await call("s3gr3do")).toBe(503);
  });
});
