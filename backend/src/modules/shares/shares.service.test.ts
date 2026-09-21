import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { createTransaction } from "../transactions/transactions.service";
import { ShareNotFoundError, createShare, getPublicShare, revokeShare } from "./shares.service";

const month = todayISO().slice(0, 7);

async function expense(userId: string, accountId: string, description: string, amount: number, isPrivate = false) {
  return createTransaction(userId, {
    accountId,
    categoryId: null,
    payerId: userId,
    description,
    amount,
    transactionType: "expense",
    occurredAt: todayISO(),
    isPrivate,
    splitType: "none",
  });
}

describe("shares", () => {
  it("snapshots only what the link is allowed to show", async () => {
    const { userAId, userBId, personalAccountId, jointAccountId } = await createTestGroup();
    await expense(userAId, jointAccountId, "mercado conjunto", 100);
    await expense(userAId, personalAccountId, "meu cafe", 10);
    await expense(userAId, personalAccountId, "presente surpresa", 50, true);

    const { id } = await createShare(userAId, month);
    const shared = await getPublicShare(id);

    const descriptions = shared.transactions.map((t) => t.description).sort();
    expect(descriptions).toEqual(["mercado conjunto", "meu cafe"]);
    expect(shared.totalExpense).toBe("110.00");
    expect(shared.ownerName).toBe("A");
    expect(shared).not.toHaveProperty("ownerId");

    // A groupmate's own personal account never shows up in someone else's link.
    const other = await createShare(userBId, month);
    const otherShared = await getPublicShare(other.id);
    expect(otherShared.transactions.map((t) => t.description)).toEqual(["mercado conjunto"]);
  });

  it("stops working once revoked, and only the owner can revoke", async () => {
    const { userAId, userBId } = await createTestGroup();
    const { id } = await createShare(userAId, month);

    await expect(revokeShare(userBId, id)).rejects.toBeInstanceOf(ShareNotFoundError);
    await revokeShare(userAId, id);
    await expect(getPublicShare(id)).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it("treats an expired link like a missing one", async () => {
    const { userAId } = await createTestGroup();
    const { id } = await createShare(userAId, month);
    await db.collection("shares").doc(id).update({ expiresAt: new Date(Date.now() - 1000) });
    await expect(getPublicShare(id)).rejects.toBeInstanceOf(ShareNotFoundError);
  });

  it("rejects an unknown token and an invalid month", async () => {
    const { userAId } = await createTestGroup();
    await expect(getPublicShare("nao-existe")).rejects.toBeInstanceOf(ShareNotFoundError);
    await expect(createShare(userAId, "2026-13")).rejects.toThrow();
  });
});
