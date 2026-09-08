import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { createDebt, listDebts, setInstallmentPaidForUser } from "./debts.service";
import { findTransactionById } from "../transactions/transactions.repository";

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("createDebt + dueDay", () => {
  it("attaches a computed dueDate to each installment when dueDay is set", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Financiamento",
      description: null,
      totalAmount: 200,
      installmentsCount: 2,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: 10,
    });

    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.dueDay).toBe(10);
    expect(found.installments[0].dueDate).toMatch(/-10$/);
  });

  it("leaves dueDate null when no dueDay was set", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Sem vencimento",
      description: null,
      totalAmount: 100,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: null,
    });

    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.installments[0].dueDate).toBeNull();
  });
});

describe("setInstallmentPaidForUser", () => {
  it("books a real expense when marking paid, and removes it when unmarking", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Cartão",
      description: null,
      totalAmount: 300,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: null,
    });
    const [withInstallments] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    const installment = withInstallments.installments[0];

    const paid = await setInstallmentPaidForUser(userAId, debt.id, installment.id, true);
    expect(paid.isPaid).toBe(true);
    expect(paid.transactionId).toBeTruthy();
    expect((await findTransactionById(paid.transactionId!))?.transactionType).toBe("expense");

    const unpaid = await setInstallmentPaidForUser(userAId, debt.id, installment.id, false);
    expect(unpaid.isPaid).toBe(false);
    expect(unpaid.transactionId).toBeNull();
  });
});
