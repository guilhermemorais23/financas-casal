// Contas sem valor certo (celular, água, luz): avisam antes de vencer, não
// lançam sozinhas e só viram gasto quando alguém diz quanto foi.
import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, type TestGroup } from "../../test-helpers";
import { addMonths, todayInBrazil } from "../../utils/month";
import { createTransaction } from "../transactions/transactions.service";
import { getUpcomingForUser } from "../upcoming/upcoming.service";
import {
  BillAlreadyPaidError,
  InvalidBillAmountError,
  createRecurringBillForUser,
  generateDueRecurringBills,
  listBillRemindersForUser,
  listRecurringBillsForUser,
  payBillForUser,
  snoozeBillForUser,
} from "./recurringBills.service";

const todayDay = () => Number(todayInBrazil().slice(8, 10));

async function phoneBill(group: TestGroup, overrides: Partial<Parameters<typeof createRecurringBillForUser>[1]> = {}) {
  return createRecurringBillForUser(group.userAId, {
    accountId: group.personalAccountId,
    categoryId: null,
    payerId: group.userAId,
    description: "Conta do celular",
    amount: null,
    amountMode: "unknown",
    transactionType: "expense",
    isPrivate: false,
    splitType: "none",
    dayOfMonth: todayDay(),
    ...overrides,
  });
}

async function transactionsOf(groupId: string) {
  return (await db.collection("transactions").where("groupId", "==", groupId).get()).docs.map((doc) => doc.data());
}

describe("contas sem valor certo", () => {
  it("valor certo continua exigindo valor; 'não sei ainda' não guarda valor", async () => {
    const group = await createTestGroup();
    await expect(phoneBill(group, { amountMode: "fixed", amount: null })).rejects.toBeInstanceOf(InvalidBillAmountError);
    await expect(phoneBill(group, { amountMode: "estimate", amount: null })).rejects.toBeInstanceOf(InvalidBillAmountError);
    const bill = await phoneBill(group, { amount: 50 });
    expect(bill.amount).toBeNull();
    expect(bill.amountMode).toBe("unknown");
    expect(bill.remindDaysBefore).toBe(3);
  });

  it("não lança sozinha no dia e aparece no aviso, só pra quem é dono da conta", async () => {
    const group = await createTestGroup();
    await phoneBill(group);
    await generateDueRecurringBills();
    expect(await transactionsOf(group.groupId)).toHaveLength(0);

    const reminders = await listBillRemindersForUser(group.userAId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ title: "Conta do celular", daysUntil: 0, amountMode: "unknown", expectedAmount: null });
    expect(await listBillRemindersForUser(group.userBId)).toHaveLength(0);

    const upcoming = await getUpcomingForUser(group.userAId);
    expect(upcoming.find((item) => item.title === "Conta do celular")).toMatchObject({ amount: 0, amountMode: "unknown" });
  });

  it("'Já paguei' lança o valor real uma vez só, mesmo com dois toques ao mesmo tempo", async () => {
    const group = await createTestGroup();
    const bill = await phoneBill(group);
    const [reminder] = await listBillRemindersForUser(group.userAId);

    const results = await Promise.allSettled([
      payBillForUser(group.userAId, bill.id, { month: reminder.month, amount: 54.9 }),
      payBillForUser(group.userAId, bill.id, { month: reminder.month, amount: 54.9 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BillAlreadyPaidError);

    const txs = await transactionsOf(group.groupId);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ description: "Conta do celular", amountCents: 5490, transactionType: "expense" });

    expect(await listBillRemindersForUser(group.userAId)).toHaveLength(0);
    const [saved] = await listRecurringBillsForUser(group.userAId);
    expect(saved.lastPaidAmount).toBe(54.9);
    expect(saved.lastGeneratedMonth).toBe(reminder.month);
  });

  it("'Já lancei no extrato' só marca o mês, sem lançar de novo", async () => {
    const group = await createTestGroup();
    const bill = await phoneBill(group);
    const [reminder] = await listBillRemindersForUser(group.userAId);
    await payBillForUser(group.userAId, bill.id, { month: reminder.month, markOnly: true });
    expect(await transactionsOf(group.groupId)).toHaveLength(0);
    expect(await listBillRemindersForUser(group.userAId)).toHaveLength(0);
  });

  it("a estimativa vira a média dos últimos 3 valores reais", async () => {
    const group = await createTestGroup();
    const bill = await phoneBill(group, { description: "Luz", amountMode: "estimate", amount: 100 });
    expect(bill.expectedAmount).toBe(100);
    const [reminder] = await listBillRemindersForUser(group.userAId);
    let month = reminder.month;
    for (const amount of [87, 112, 95]) {
      await payBillForUser(group.userAId, bill.id, { month, amount });
      month = addMonths(month, 1);
    }
    const [saved] = await listRecurringBillsForUser(group.userAId);
    expect(saved.expectedAmount).toBe(98);
  });

  it("'Me lembre mais tarde' esconde o aviso até amanhã; 'quando o salário cair' até entrar uma receita", async () => {
    const group = await createTestGroup();
    const bill = await phoneBill(group);

    await snoozeBillForUser(group.userAId, bill.id, "tomorrow");
    expect(await listBillRemindersForUser(group.userAId)).toHaveLength(0);
    // A lista "Contas do mês" mostra mesmo adiada.
    const all = await listBillRemindersForUser(group.userAId, { includeAll: true });
    expect(all).toHaveLength(1);
    expect(all[0].snoozed).toBe(true);

    await snoozeBillForUser(group.userAId, bill.id, "salary");
    expect(await listBillRemindersForUser(group.userAId)).toHaveLength(0);
    await createTransaction(group.userAId, {
      accountId: group.personalAccountId,
      categoryId: null,
      payerId: group.userAId,
      description: "Salário",
      amount: 3200,
      transactionType: "income",
      occurredAt: todayInBrazil(),
      isPrivate: false,
      splitType: "none",
    });
    expect(await listBillRemindersForUser(group.userAId)).toHaveLength(1);
  });
});
