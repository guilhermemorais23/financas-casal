import { afterEach, describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { setPluggyFetch } from "../../utils/pluggy";
import { createTransaction } from "../transactions/transactions.service";
import { deleteAccountForUser } from "./deleteAccount.service";

afterEach(() => {
  setPluggyFetch(null);
  delete process.env.PLUGGY_CLIENT_ID;
  delete process.env.PLUGGY_CLIENT_SECRET;
});

describe("excluir conta: conexões e dados por pessoa", () => {
  it("desconecta o banco no Pluggy e apaga push, regras de importação e assinatura", async () => {
    const { groupId, userAId, userBId } = await createTestGroup();
    process.env.PLUGGY_CLIENT_ID = "id";
    process.env.PLUGGY_CLIENT_SECRET = "secret";
    const deletedAtPluggy: string[] = [];
    setPluggyFetch(async (url, init) => {
      const path = new URL(url).pathname.slice(1);
      if (path === "auth") return new Response(JSON.stringify({ apiKey: "k" }), { status: 200 });
      const item = path.match(/^items\/(.+)$/);
      if (item && init?.method === "DELETE") deletedAtPluggy.push(item[1]);
      return new Response(null, { status: 204 });
    });
    const itemId = `item-${userAId}`;
    await db.collection("openFinanceItems").doc(itemId).set({ itemId, userId: userAId, groupId, connectorName: "MeuPluggy", createdAt: 1, syncedUntil: {} });
    await db.collection("pushSubscriptions").doc(`push-${userAId}`).set({ userId: userAId, endpoint: "https://push.example/a" });
    await db.collection("importRules").doc(`${groupId}__mercado`).set({ groupId, key: "mercado", label: "Mercado" });
    await db.collection("subscriptions").doc(groupId).set({ status: "trialing" });

    await deleteAccountForUser(userAId);

    expect(deletedAtPluggy).toEqual([itemId]);
    expect((await db.collection("openFinanceItems").doc(itemId).get()).exists).toBe(false);
    expect((await db.collection("pushSubscriptions").doc(`push-${userAId}`).get()).exists).toBe(false);
    // B ainda está no grupo: as regras e a assinatura do grupo ficam.
    expect((await db.collection("importRules").doc(`${groupId}__mercado`).get()).exists).toBe(true);

    await deleteAccountForUser(userBId);

    expect((await db.collection("importRules").doc(`${groupId}__mercado`).get()).exists).toBe(false);
    expect((await db.collection("subscriptions").doc(groupId).get()).exists).toBe(false);
  });
});

async function countWhere(collection: string, field: string, value: string) {
  return (await db.collection(collection).where(field, "==", value).get()).size;
}

describe("excluir conta", () => {
  it("keeps the joint data while someone is left, and erases the whole group with the last member", async () => {
    const { groupId, userAId, userBId, personalAccountId, jointAccountId } = await createTestGroup();
    const base = { categoryId: null, occurredAt: todayISO(), isPrivate: false, splitType: "none" as const };
    await createTransaction(userAId, { ...base, accountId: personalAccountId, payerId: userAId, description: "Só minha", amount: 10, transactionType: "expense" });
    await createTransaction(userAId, { ...base, accountId: jointAccountId, payerId: userAId, description: "Do casal", amount: 20, transactionType: "expense" });

    await deleteAccountForUser(userAId);

    expect((await db.collection("users").doc(userAId).get()).exists).toBe(false);
    expect(await countWhere("transactions", "accountOwnerId", userAId)).toBe(0);
    expect((await db.collection("accounts").doc(personalAccountId).get()).exists).toBe(false);
    // B continua no grupo: a Nossa Conta e o que foi lançado nela ficam.
    expect(await countWhere("transactions", "accountId", jointAccountId)).toBe(1);
    expect((await db.collection("groups").doc(groupId).get()).exists).toBe(true);

    await deleteAccountForUser(userBId);

    expect(await countWhere("transactions", "groupId", groupId)).toBe(0);
    expect(await countWhere("accounts", "groupId", groupId)).toBe(0);
    expect((await db.collection("groups").doc(groupId).get()).exists).toBe(false);
  });
});
