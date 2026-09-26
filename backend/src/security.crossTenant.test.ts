import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "./test-helpers";
import { createTransaction, deleteTransactionForUser, updateTransactionForUser } from "./modules/transactions/transactions.service";
import { findTransactionById } from "./modules/transactions/transactions.repository";
import { createGoal, contributeToGoal, removeGoal } from "./modules/goals/goals.service";
import { addItem, removeItem, uncheckItem } from "./modules/shopping/shopping.service";
import { createDebt, removeDebt } from "./modules/debts/debts.service";
import { createCard, removeCard, getStatement, addPurchase } from "./modules/cards/cards.service";
import { createLoan, removeLoan, addRepayment } from "./modules/loans/loans.service";
import {
  createRecurringBillForUser,
  deleteRecurringBillForUser,
  updateRecurringBillForUser,
} from "./modules/recurringBills/recurringBills.service";
import { removeMemberForUser } from "./modules/groups/groups.service";

// Segurança entre contas: alguém logado de OUTRO grupo, sabendo o id de um
// item (lançamento, meta, cartão...), não consegue ler, mudar nem apagar.
// E dentro do casal, o lançamento pessoal de um não é editável pelo outro.
describe("segurança: um grupo não mexe nos dados de outro", () => {
  it("bloqueia lançamentos, metas, compras, dívidas, cartões, empréstimos e contas fixas de outro grupo", async () => {
    const victim = await createTestGroup();
    const intruder = await createTestGroup();
    const a = victim.userAId;
    const x = intruder.userAId;

    const tx = await createTransaction(a, {
      accountId: victim.jointAccountId,
      categoryId: null,
      payerId: a,
      description: "Aluguel",
      amount: 1000,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none",
    });
    const goal = await createGoal(a, { name: "Viagem", emoji: null, photoDataUrl: null, targetAmount: 5000, deadline: null });
    const item = await addItem(a, "Arroz");
    const debt = await createDebt(a, {
      name: "Carro",
      description: null,
      totalAmount: 1200,
      installmentsCount: 12,
      scope: "joint",
      startMonth: todayISO().slice(0, 7),
      dueDay: null,
    });
    const card = await createCard(a, { name: "Nubank", closingDay: 1, dueDay: 10, scope: "joint", limit: 1000, limitType: "normal" });
    const loan = await createLoan(a, {
      personName: "Tio",
      amount: 300,
      lentAt: todayISO(),
      dueDate: null,
      note: null,
      accountId: victim.jointAccountId,
    });
    const bill = await createRecurringBillForUser(a, {
      accountId: victim.jointAccountId,
      categoryId: null,
      payerId: a,
      description: "Internet",
      amount: 100,
      transactionType: "expense",
      isPrivate: false,
      splitType: "none",
      dayOfMonth: 5,
    });

    const attempts: [string, () => Promise<unknown>][] = [
      ["editar lançamento", () => updateTransactionForUser(x, tx.id, { description: "hack", amount: 1 } as never)],
      ["apagar lançamento", () => deleteTransactionForUser(x, tx.id)],
      ["aportar em meta", () => contributeToGoal(x, goal.id, 10)],
      ["apagar meta", () => removeGoal(x, goal.id)],
      ["desmarcar compra", () => uncheckItem(x, item.id)],
      ["apagar compra", () => removeItem(x, item.id)],
      ["apagar dívida", () => removeDebt(x, debt.id)],
      ["ver fatura do cartão", () => getStatement(x, card.id)],
      ["lançar no cartão", () => addPurchase(x, card.id, { description: "hack", amount: 1, purchasedAt: todayISO(), installments: 1 } as never)],
      ["apagar cartão", () => removeCard(x, card.id)],
      ["receber empréstimo", () => addRepayment(x, loan.id, { amount: 1, paidAt: todayISO() } as never)],
      ["apagar empréstimo", () => removeLoan(x, loan.id)],
      ["editar conta fixa", () => updateRecurringBillForUser(x, bill.id, { description: "hack" } as never)],
      ["apagar conta fixa", () => deleteRecurringBillForUser(x, bill.id)],
      ["tirar alguém do grupo", () => removeMemberForUser(x, victim.userBId)],
      [
        "lançar na conta de outro grupo",
        () =>
          createTransaction(x, {
            accountId: victim.jointAccountId,
            categoryId: null,
            payerId: x,
            description: "hack",
            amount: 1,
            transactionType: "expense",
            occurredAt: todayISO(),
            isPrivate: false,
            splitType: "none",
          }),
      ],
    ];
    const allowed: string[] = [];
    for (const [label, attempt] of attempts) {
      try {
        await attempt();
        allowed.push(label);
      } catch (err) {
        // recusado: o esperado
        if (process.env.SHOW_REASONS) console.log("RECUSA", label, (err as Error).constructor.name, (err as Error).message);
      }
    }
    expect(allowed).toEqual([]);
    // E nada mudou de verdade.
    expect((await findTransactionById(tx.id))?.description).toBe("Aluguel");
  });

  it("no casal, o lançamento da conta pessoal de um não é editável nem apagável pelo outro", async () => {
    const g = await createTestGroup();
    const mine = await createTransaction(g.userAId, {
      accountId: g.personalAccountId,
      categoryId: null,
      payerId: g.userAId,
      description: "Presente surpresa",
      amount: 200,
      transactionType: "expense",
      occurredAt: todayISO(),
      isPrivate: true,
      splitType: "none",
    });
    await expect(updateTransactionForUser(g.userBId, mine.id, { description: "vi" } as never)).rejects.toThrow();
    await expect(deleteTransactionForUser(g.userBId, mine.id)).rejects.toThrow();
  });
});
