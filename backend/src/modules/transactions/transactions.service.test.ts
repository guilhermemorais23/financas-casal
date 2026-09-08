import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { addMonthsToDate } from "../../utils/month";
import { db } from "../../db/firestore";
import {
  InvalidAccountError,
  createTransaction,
  getBalance,
  getYearlySummaryForUser,
  setSplitSettledForUser,
  updateRecurringForUser,
  updateTransactionForUser,
} from "./transactions.service";
import { findTransactionById } from "./transactions.repository";

describe("createTransaction: equal split", () => {
  it("creates one split doc per member, dividing evenly", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "lanche",
      amount: 100,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "equal",
    });

    const splits = await db.collection("transactions").doc(tx.id).collection("splits").get();
    expect(splits.size).toBe(2);
    const total = splits.docs.reduce((sum, doc) => sum + doc.data().shareAmountCents, 0);
    expect(total).toBe(10000); // R$100 in cents, no rounding leakage
  });
});

describe("createTransaction: recurring", () => {
  it("generates the full batch up front, clamping day-of-month at month boundaries", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const first = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "assinatura",
      amount: 39.9,
      transactionType: "expense",
      occurredAt: "2026-01-31",
      isPrivate: false,
      splitType: "none",
      recurring: { months: 3 },
    });

    expect(first.recurringTotal).toBe(3);
    const snap = await db.collection("transactions").where("recurringGroupId", "==", first.recurringGroupId).get();
    const dates = snap.docs.map((doc) => doc.data().occurredAt).sort();
    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
  });
});

describe("updateTransactionForUser: moving accounts", () => {
  it("re-derives accountType/accountOwnerId from the new account", async () => {
    const { userAId, personalAccountId, jointAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "gasto",
      amount: 10,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });

    const moved = await updateTransactionForUser(userAId, tx.id, { accountId: jointAccountId });
    expect(moved.accountId).toBe(jointAccountId);
    expect(moved.accountType).toBe("joint");
    expect(moved.accountOwnerId).toBeNull();
  });

  it("rejects moving to an account outside the group", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "gasto",
      amount: 10,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });

    await expect(
      updateTransactionForUser(userAId, tx.id, { accountId: "does-not-exist" })
    ).rejects.toBeInstanceOf(InvalidAccountError);
  });
});

describe("setSplitSettledForUser", () => {
  it("books a real income transaction when settling, and removes it on reopen", async () => {
    const { userAId, userBId, personalAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "lanche MAC",
      amount: 100,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "equal",
    });

    const before = await getBalance(userAId);
    expect(before.balances).toEqual([{ fromUserId: userBId, toUserId: userAId, amount: 50 }]);

    const settled = await setSplitSettledForUser(userAId, tx.id, true, 50);
    expect(settled.isSettled).toBe(true);
    expect(settled.settlementTransactionId).toBeTruthy();

    const reembolso = await findTransactionById(settled.settlementTransactionId!);
    expect(reembolso?.transactionType).toBe("income");
    expect(reembolso?.amount).toBe("50.00");

    const afterSettle = await getBalance(userAId);
    expect(afterSettle.balances).toEqual([]);

    const reopened = await setSplitSettledForUser(userAId, tx.id, false);
    expect(reopened.isSettled).toBe(false);
    expect(await findTransactionById(settled.settlementTransactionId!)).toBeNull();

    const afterReopen = await getBalance(userAId);
    expect(afterReopen.balances).toEqual([{ fromUserId: userBId, toUserId: userAId, amount: 50 }]);
  });
});

describe("updateRecurringForUser", () => {
  it("rewrites amount on this-and-future occurrences only", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const first = await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "aluguel",
      amount: 1000,
      transactionType: "expense",
      occurredAt: "2026-01-01",
      isPrivate: false,
      splitType: "none",
      recurring: { months: 3 },
    });

    const result = await updateRecurringForUser(userAId, first.id, { amount: 1200 });
    expect(result.updatedCount).toBe(3);

    const snap = await db.collection("transactions").where("recurringGroupId", "==", first.recurringGroupId).get();
    for (const doc of snap.docs) {
      expect(doc.data().amountCents).toBe(120000);
    }
  });
});

describe("getYearlySummaryForUser", () => {
  it("buckets income/expense into all 12 months of the requested year", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    await createTransaction(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "salario",
      amount: 3000,
      transactionType: "income",
      occurredAt: "2027-06-05",
      isPrivate: false,
      splitType: "none",
    });

    const summary = await getYearlySummaryForUser(userAId, "2027");
    expect(summary.months).toHaveLength(12);
    const june = summary.months.find((m) => m.month === "2027-06");
    expect(june?.income).toBe("3000.00");
    expect(summary.totalIncome).toBe("3000.00");
  });
});
