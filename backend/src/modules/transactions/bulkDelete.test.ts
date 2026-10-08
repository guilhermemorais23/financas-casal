import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { addPurchase, createCard, setStatementPaidForUser } from "../cards/cards.service";
import { InvalidBulkDeleteError, createTransaction, deleteTransactionsForUser } from "./transactions.service";

describe("excluir vários lançamentos", () => {
  it("apaga os normais e devolve os que não pode apagar, com o motivo", async () => {
    const { userAId, userBId, personalAccountId, jointAccountId } = await createTestGroup();
    const base = {
      categoryId: null,
      payerId: userAId,
      transactionType: "expense" as const,
      occurredAt: todayISO(),
      isPrivate: false,
      splitType: "none" as const,
    };
    const a = await createTransaction(userAId, { ...base, accountId: personalAccountId, description: "Padaria", amount: 12 });
    const b = await createTransaction(userAId, { ...base, accountId: jointAccountId, description: "Mercado", amount: 200 });
    const card = await createCard(userAId, { name: "Nubank", closingDay: 31, dueDay: 5, scope: "personal", limit: null, limitType: "normal" });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Tênis",
      amount: 300,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO(),
      installments: 1,
    });
    const statement = await setStatementPaidForUser(userAId, card.id, purchase.statementMonth, true);

    // B não pode apagar o lançamento pessoal de A.
    const byB = await deleteTransactionsForUser(userBId, [a.id]);
    expect(byB).toEqual({ deleted: 0, skipped: [{ id: a.id, reason: "not_found" }] });

    const result = await deleteTransactionsForUser(userAId, [a.id, b.id, statement.transactionId!]);
    expect(result.deleted).toBe(2);
    expect(result.skipped).toEqual([{ id: statement.transactionId, reason: "card_statement" }]);
    expect((await db.collection("transactions").doc(a.id).get()).exists).toBe(false);
    expect((await db.collection("transactions").doc(statement.transactionId!).get()).exists).toBe(true);
  });

  it("recusa lista vazia", async () => {
    const { userAId } = await createTestGroup();
    await expect(deleteTransactionsForUser(userAId, [])).rejects.toBeInstanceOf(InvalidBulkDeleteError);
  });
});
