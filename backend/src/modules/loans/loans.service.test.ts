import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { getGroupForUser } from "../groups/groups.service";
import { deleteTransactionForUser, SecuredCardTransferError } from "../transactions/transactions.service";
import {
  InvalidLoanAccountError,
  RepaymentTooLargeError,
  addRepayment,
  createLoan,
  listLoans,
  removeLoan,
  removeRepayment,
  summarize,
  updateLoanForUser,
} from "./loans.service";

async function balanceOf(userId: string, accountId: string): Promise<number> {
  const group = await getGroupForUser(userId);
  return group!.accounts.find((a) => a.id === accountId)!.balance;
}

describe("loans", () => {
  it("lending takes the money out of the account and receiving brings it back", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const loan = await createLoan(userAId, {
      personName: "Mãe",
      amount: 500,
      lentAt: todayISO(),
      dueDate: null,
      note: null,
      accountId: personalAccountId,
    });
    expect(await balanceOf(userAId, personalAccountId)).toBe(-500);

    const partial = await addRepayment(userAId, loan.id, { amount: 200, receivedAt: todayISO(), accountId: personalAccountId });
    expect(partial.remaining).toBe("300.00");
    expect(partial.status).toBe("open");
    expect(await balanceOf(userAId, personalAccountId)).toBe(-300);

    await expect(
      addRepayment(userAId, loan.id, { amount: 400, receivedAt: todayISO(), accountId: personalAccountId })
    ).rejects.toBeInstanceOf(RepaymentTooLargeError);

    const done = await addRepayment(userAId, loan.id, { amount: 300, receivedAt: todayISO(), accountId: personalAccountId });
    expect(done.status).toBe("paid");
    expect(await balanceOf(userAId, personalAccountId)).toBe(0);

    const undone = await removeRepayment(userAId, loan.id, done.repayments[1].id);
    expect(undone.status).toBe("open");
    expect(undone.remaining).toBe("300.00");
  });

  it("the transfer can't be deleted from the extrato, and deleting the loan undoes it", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const loan = await createLoan(userAId, {
      personName: "João",
      amount: 150,
      lentAt: todayISO(),
      dueDate: null,
      note: null,
      accountId: personalAccountId,
    });
    await expect(deleteTransactionForUser(userAId, loan.transactionId!)).rejects.toBeInstanceOf(SecuredCardTransferError);
    await removeLoan(userAId, loan.id);
    expect(await balanceOf(userAId, personalAccountId)).toBe(0);
    expect((await listLoans(userAId)).loans).toHaveLength(0);
  });

  it("a loan registered without an account doesn't touch any balance", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    await createLoan(userAId, { personName: "Tio", amount: 80, lentAt: "2026-01-10", dueDate: null, note: null, accountId: null });
    expect(await balanceOf(userAId, personalAccountId)).toBe(0);
  });

  it("is private to whoever lent and can't use the partner's personal account", async () => {
    const { userAId, userBId, personalAccountId } = await createTestGroup();
    await createLoan(userAId, { personName: "Irmã", amount: 50, lentAt: todayISO(), dueDate: null, note: null, accountId: null });
    expect((await listLoans(userBId)).loans).toHaveLength(0);
    await expect(
      createLoan(userBId, { personName: "X", amount: 10, lentAt: todayISO(), dueDate: null, note: null, accountId: personalAccountId })
    ).rejects.toBeInstanceOf(InvalidLoanAccountError);
  });

  it("forgiving leaves it out of what's still to receive", async () => {
    const { userAId } = await createTestGroup();
    const loan = await createLoan(userAId, { personName: "Primo", amount: 90, lentAt: todayISO(), dueDate: null, note: null, accountId: null });
    await updateLoanForUser(userAId, loan.id, { status: "forgiven" });
    const { summary } = await listLoans(userAId);
    expect(summary.outstanding).toBe("0.00");
  });
});

describe("summarize", () => {
  const base = { groupId: "g", ownerUserId: "u", lentAt: "2026-01-01", note: null, accountId: null, transactionId: null, repayments: [], received: "0.00", status: "open" as const };
  it("splits what's owed into overdue, due soon and no deadline", () => {
    const summary = summarize(
      [
        { ...base, id: "1", personName: "A", amount: "100.00", remaining: "100.00", dueDate: "2026-09-01", isOverdue: true },
        { ...base, id: "2", personName: "B", amount: "50.00", remaining: "50.00", dueDate: "2026-10-05", isOverdue: false },
        { ...base, id: "3", personName: "C", amount: "30.00", remaining: "30.00", dueDate: null, isOverdue: false },
        { ...base, id: "4", personName: "D", amount: "70.00", remaining: "70.00", dueDate: "2027-05-01", isOverdue: false },
      ],
      "2026-09-24"
    );
    expect(summary).toEqual({
      outstanding: "250.00",
      overdue: "100.00",
      overdueCount: 1,
      dueSoon: "50.00",
      noDueDate: "30.00",
      openCount: 4,
    });
  });
});
