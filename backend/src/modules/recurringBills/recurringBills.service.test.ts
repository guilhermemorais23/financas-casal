import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { db } from "../../db/firestore";
import {
  createRecurringBillForUser,
  generateDueRecurringBills,
  listRecurringBillsForUser,
  updateRecurringBillForUser,
} from "./recurringBills.service";

describe("recurringBills", () => {
  it("a personal bill is only visible to its owner; a joint one is visible to both", async () => {
    const { userAId, userBId, personalAccountId, jointAccountId } = await createTestGroup();

    await createRecurringBillForUser(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Netflix",
      amount: 40,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: 10,
    });
    await createRecurringBillForUser(userAId, {
      accountId: jointAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Aluguel",
      amount: 1500,
      transactionType: "expense",
      isPrivate: false,
      splitType: "equal",
      dayOfMonth: 5,
    });

    const seenByA = await listRecurringBillsForUser(userAId);
    const seenByB = await listRecurringBillsForUser(userBId);

    expect(seenByA.map((bill) => bill.description).sort()).toEqual(["Aluguel", "Netflix"]);
    expect(seenByB.map((bill) => bill.description)).toEqual(["Aluguel"]);
  });

  it("generates a transaction once its day arrives, and only once per month", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const today = new Date().getUTCDate();

    await createRecurringBillForUser(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Academia",
      amount: 120,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: today,
    });

    await generateDueRecurringBills();
    const afterFirstRun = await db.collection("transactions").where("groupId", "==", groupId).get();
    expect(afterFirstRun.size).toBe(1);
    expect(afterFirstRun.docs[0].data().description).toBe("Academia");

    // Same day, run again (cron fires more than once, or twice in one day) --
    // must not create a second transaction for the same month.
    await generateDueRecurringBills();
    const afterSecondRun = await db.collection("transactions").where("groupId", "==", groupId).get();
    expect(afterSecondRun.size).toBe(1);
  });

  it("skips a paused bill", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const bill = await createRecurringBillForUser(userAId, {
      accountId: personalAccountId,
      categoryId: null,
      payerId: userAId,
      description: "Revista",
      amount: 25,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: new Date().getUTCDate(),
    });

    await updateRecurringBillForUser(userAId, bill.id, { isActive: false });
    await generateDueRecurringBills();

    const transactions = await db.collection("transactions").where("groupId", "==", groupId).get();
    expect(transactions.size).toBe(0);
  });
});
