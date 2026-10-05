// Dinheiro que não pode duplicar nem sumir: cliques duplos (ou a rede
// repetindo o pedido) em tudo que cria um lançamento ligado a outra coisa, e
// lançamentos que só podem ser desfeitos pela tela que os criou.
import { describe, expect, it } from "vitest";
import { db } from "./db/firestore";
import { createTestGroup, todayISO } from "./test-helpers";
import { runWithActiveGroup } from "./utils/activeGroup";
import { memoizeReads, invalidateTransactionReads, clearReadCache } from "./utils/readCache";
import { isIsoDate, isValidAmount } from "./utils/validation";
import { addPurchase, createCard, setStatementPaidForUser } from "./modules/cards/cards.service";
import { createDebt, listDebts, setInstallmentPaidForUser } from "./modules/debts/debts.service";
import { addRepayment, createLoan } from "./modules/loans/loans.service";
import { acceptInvite, AlreadyInGroupError, createGroupForUser, createNewInvite, InviteNotPendingError } from "./modules/groups/groups.service";
import {
  InvalidAccountError,
  LinkedTransactionError,
  createTransaction,
  deleteTransactionForUser,
  setSplitSettledForUser,
  updateTransactionForUser,
} from "./modules/transactions/transactions.service";
import { findTransactionById } from "./modules/transactions/transactions.repository";

const transactionsCol = db.collection("transactions");

async function sharedExpense(userId: string, accountId: string) {
  return createTransaction(userId, {
    accountId,
    categoryId: null,
    payerId: userId,
    description: "Mercado",
    amount: 100,
    transactionType: "expense",
    occurredAt: todayISO(),
    isPrivate: false,
    splitType: "equal",
  });
}

describe("conta pessoal de outra pessoa", () => {
  it("não deixa lançar nem mover lançamento pra conta pessoal do parceiro", async () => {
    const { userBId, personalAccountId, jointAccountId } = await createTestGroup();
    await expect(
      createTransaction(userBId, {
        accountId: personalAccountId,
        categoryId: null,
        payerId: userBId,
        description: "x",
        amount: 10,
        transactionType: "expense",
        occurredAt: todayISO(),
        isPrivate: false,
        splitType: "none",
      })
    ).rejects.toBeInstanceOf(InvalidAccountError);

    const tx = await sharedExpense(userBId, jointAccountId);
    await expect(updateTransactionForUser(userBId, tx.id, { accountId: personalAccountId })).rejects.toBeInstanceOf(
      InvalidAccountError
    );
  });
});

describe("cliques duplos", () => {
  it("'pago' duas vezes ao mesmo tempo cria um reembolso só", async () => {
    const { userAId, jointAccountId } = await createTestGroup();
    const tx = await sharedExpense(userAId, jointAccountId);
    await Promise.all([
      setSplitSettledForUser(userAId, tx.id, true, 50),
      setSplitSettledForUser(userAId, tx.id, true, 50),
    ]);
    // e chamar de novo depois também não
    await setSplitSettledForUser(userAId, tx.id, true, 50);
    const refunds = await transactionsCol.where("groupId", "==", tx.groupId).where("transactionType", "==", "income").get();
    expect(refunds.size).toBe(1);
    expect((await findTransactionById(tx.id))!.settlementTransactionId).toBe(refunds.docs[0].id);

    await setSplitSettledForUser(userAId, tx.id, false);
    expect((await transactionsCol.doc(refunds.docs[0].id).get()).exists).toBe(false);
  });

  it("pagar a mesma fatura duas vezes ao mesmo tempo lança uma só", async () => {
    const { userAId, groupId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO(),
      installments: 1,
    });
    await Promise.all([
      setStatementPaidForUser(userAId, card.id, purchase.statementMonth, true),
      setStatementPaidForUser(userAId, card.id, purchase.statementMonth, true),
    ]);
    const payments = await transactionsCol.where("groupId", "==", groupId).get();
    expect(payments.size).toBe(1);
    expect(payments.docs[0].data().linkKind).toBe("card_statement");
  });

  it("pagar a mesma parcela duas vezes ao mesmo tempo lança uma só", async () => {
    const { userAId, groupId } = await createTestGroup();
    await createDebt(userAId, {
      name: "Geladeira",
      description: null,
      totalAmount: 1200,
      installmentsCount: 12,
      scope: "personal",
      startMonth: todayISO().slice(0, 7),
      dueDay: null,
    });
    const [debt] = await listDebts(userAId);
    const installmentId = debt.installments[0].id;
    await Promise.all([
      setInstallmentPaidForUser(userAId, debt.id, installmentId, true),
      setInstallmentPaidForUser(userAId, debt.id, installmentId, true),
    ]);
    const payments = await transactionsCol.where("groupId", "==", groupId).get();
    expect(payments.size).toBe(1);
  });

  it("dois recebimentos de empréstimo ao mesmo tempo não se apagam nem passam do total", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const loan = await createLoan(userAId, {
      personName: "Ana",
      amount: 100,
      lentAt: todayISO(),
      dueDate: null,
      note: null,
      accountId: personalAccountId,
    });
    const results = await Promise.allSettled([
      addRepayment(userAId, loan.id, { amount: 60, receivedAt: todayISO(), accountId: personalAccountId }),
      addRepayment(userAId, loan.id, { amount: 60, receivedAt: todayISO(), accountId: personalAccountId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const saved = (await db.collection("loans").doc(loan.id).get()).data()!;
    expect(saved.repayments).toHaveLength(1);
    // um lançamento do empréstimo + um do recebimento, nenhum órfão
    const linked = await transactionsCol.where("loanId", "==", loan.id).get();
    expect(linked.size).toBe(2);
  });

  it("aceitar o mesmo convite duas vezes não cria duas contas", async () => {
    const { userAId } = await createTestGroup();
    const { group } = await createGroupForUser(userAId, { name: "Casa" });
    const token = await runWithActiveGroup(group.id, () => createNewInvite(userAId));
    const userCId = `test-c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.collection("users").doc(userCId).set({ email: `${userCId}@test.com`, displayName: "C", groupId: null });

    const results = await Promise.allSettled([acceptInvite(userCId, token), acceptInvite(userCId, token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason instanceof InviteNotPendingError || rejected.reason instanceof AlreadyInGroupError).toBe(true);

    const accounts = await db.collection("accounts").where("groupId", "==", group.id).where("ownerUserId", "==", userCId).get();
    expect(accounts.size).toBe(1);
  });
});

describe("lançamento vinculado", () => {
  it("pagamento de fatura não se apaga nem muda de valor pelo extrato, mas a categoria pode", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, { name: "Inter", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Livro",
      amount: 50,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO(),
      installments: 1,
    });
    const statement = await setStatementPaidForUser(userAId, card.id, purchase.statementMonth, true);
    const paymentId = statement.transactionId!;

    await expect(deleteTransactionForUser(userAId, paymentId)).rejects.toBeInstanceOf(LinkedTransactionError);
    await expect(updateTransactionForUser(userAId, paymentId, { amount: 1 })).rejects.toBeInstanceOf(LinkedTransactionError);
    const renamed = await updateTransactionForUser(userAId, paymentId, { description: "Fatura do Inter", amount: 50 });
    expect(renamed.description).toBe("Fatura do Inter");
  });

  it("reconhece reembolso antigo (sem linkKind) e não deixa apagar", async () => {
    const { userAId, jointAccountId } = await createTestGroup();
    const tx = await sharedExpense(userAId, jointAccountId);
    const settled = await setSplitSettledForUser(userAId, tx.id, true, 50);
    // como era antes do campo existir
    await transactionsCol.doc(settled.settlementTransactionId!).update({ linkKind: null });
    await expect(deleteTransactionForUser(userAId, settled.settlementTransactionId!)).rejects.toBeInstanceOf(
      LinkedTransactionError
    );
  });
});

describe("divisões", () => {
  it("receita que vira despesa dividida ganha as divisões", async () => {
    const { userAId, jointAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      accountId: jointAccountId,
      categoryId: null,
      payerId: userAId,
      description: "era receita",
      amount: 80,
      transactionType: "income",
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "equal",
    });
    expect((await transactionsCol.doc(tx.id).collection("splits").get()).size).toBe(0);
    await updateTransactionForUser(userAId, tx.id, { transactionType: "expense" });
    const splits = await transactionsCol.doc(tx.id).collection("splits").get();
    expect(splits.docs.map((doc) => doc.data().shareAmountCents).sort()).toEqual([4000, 4000]);
  });
});

describe("validação", () => {
  it("valor precisa ser um número de verdade, de pelo menos 1 centavo", () => {
    expect(isValidAmount(10)).toBe(true);
    expect(isValidAmount(0.01)).toBe(true);
    expect(isValidAmount(Infinity)).toBe(false);
    expect(isValidAmount(JSON.parse("1e400"))).toBe(false);
    expect(isValidAmount(0.001)).toBe(false);
    expect(isValidAmount(-5)).toBe(false);
    expect(isValidAmount("10")).toBe(false);
  });

  it("data precisa existir no calendário", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("31/12/2026")).toBe(false);
    expect(isIsoDate("zzz")).toBe(false);
  });
});

describe("cache de leituras por grupo", () => {
  it("gravar num grupo não joga fora o cache do outro", async () => {
    clearReadCache();
    let loadsA = 0;
    let loadsB = 0;
    const readA = () => memoizeReads("a", async () => ++loadsA, "group-a");
    const readB = () => memoizeReads("b", async () => ++loadsB, "group-b");
    await readA();
    await readB();
    invalidateTransactionReads("group-a");
    await readA();
    await readB();
    expect(loadsA).toBe(2);
    expect(loadsB).toBe(1);
    invalidateTransactionReads();
    await readB();
    expect(loadsB).toBe(2);
  });
});
