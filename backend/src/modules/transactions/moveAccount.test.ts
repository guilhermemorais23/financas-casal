// "Passar pra minha conta" / "Passar pro grupo": o lançamento troca de conta
// (pessoal <-> Nossa Conta) sem ser apagado e lançado de novo. O dinheiro
// guardado num cartão garantido leva o cartão junto -- é o caso de quem criou
// o cartão como "Do grupo" (o padrão) e viu a Nossa Conta ficar negativa.
import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { createCard, listCards } from "../cards/cards.service";
import { findSecuredCardTransferIds, findTransactionById } from "./transactions.repository";
import { createTransaction, deleteTransactionForUser, LinkedTransactionError, TransactionNotFoundError } from "./transactions.service";
import { moveTransactionForUser } from "./moveAccount.service";

const base = { categoryId: null, isPrivate: false, splitType: "none" as const, occurredAt: todayISO() };

describe("passar lançamento entre a conta pessoal e a Nossa Conta", () => {
  it("guardado num cartão do grupo: passa pra minha conta e o cartão vira pessoal", async () => {
    const { userAId, personalAccountId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Inter", closingDay: 10, dueDay: 20, scope: "joint", limit: 170, limitType: "secured", securedFromAccount: true,
    });
    const [transferId] = await findSecuredCardTransferIds(card.id);

    await moveTransactionForUser(userAId, transferId, "personal");

    expect((await findTransactionById(transferId))!.accountId).toBe(personalAccountId);
    const [after] = await listCards(userAId);
    expect(after.scope).toBe("personal");
    expect(after.limit).toBe("170.00");
  });

  it("gasto da Nossa Conta lançado pelo parceiro: passa pra minha conta e fica sob meu controle", async () => {
    const { userAId, userBId, jointAccountId, personalAccountId } = await createTestGroup();
    const tx = await createTransaction(userBId, {
      ...base, accountId: jointAccountId, payerId: userAId, description: "Farmácia", amount: 40, transactionType: "expense",
    });

    await moveTransactionForUser(userAId, tx.id, "personal");

    const moved = (await findTransactionById(tx.id))!;
    expect(moved).toMatchObject({ accountId: personalAccountId, accountType: "personal", createdBy: userAId });
    // Na conta pessoal de A, o parceiro não mexe mais.
    await expect(deleteTransactionForUser(userBId, tx.id)).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it("da minha conta pro grupo", async () => {
    const { userAId, personalAccountId, jointAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      ...base, accountId: personalAccountId, payerId: userAId, description: "Mercado", amount: 90, transactionType: "expense",
    });
    await moveTransactionForUser(userAId, tx.id, "joint");
    expect((await findTransactionById(tx.id))!.accountId).toBe(jointAccountId);
  });

  it("lançamento pessoal de outra pessoa: não dá pra mover", async () => {
    const { userAId, userBId, personalAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      ...base, accountId: personalAccountId, payerId: userAId, description: "Cinema", amount: 30, transactionType: "expense",
    });
    await expect(moveTransactionForUser(userBId, tx.id, "joint")).rejects.toBeInstanceOf(TransactionNotFoundError);
  });

  it("pagamento de fatura: só pela tela de Cartões", async () => {
    const { userAId, jointAccountId } = await createTestGroup();
    const tx = await createTransaction(userAId, {
      ...base, accountId: jointAccountId, payerId: userAId, description: "Fatura", amount: 50, transactionType: "expense",
    });
    const { db } = await import("../../db/firestore");
    await db.collection("transactions").doc(tx.id).update({ linkKind: "card_statement" });
    await expect(moveTransactionForUser(userAId, tx.id, "personal")).rejects.toBeInstanceOf(LinkedTransactionError);
  });
});
