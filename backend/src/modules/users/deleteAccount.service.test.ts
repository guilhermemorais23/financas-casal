import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { createTransaction } from "../transactions/transactions.service";
import { deleteAccountForUser } from "./deleteAccount.service";

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
    // B is still in the group: Nossa Conta and what was booked on it stay.
    expect(await countWhere("transactions", "accountId", jointAccountId)).toBe(1);
    expect((await db.collection("groups").doc(groupId).get()).exists).toBe(true);

    await deleteAccountForUser(userBId);

    expect(await countWhere("transactions", "groupId", groupId)).toBe(0);
    expect(await countWhere("accounts", "groupId", groupId)).toBe(0);
    expect((await db.collection("groups").doc(groupId).get()).exists).toBe(false);
  });
});
