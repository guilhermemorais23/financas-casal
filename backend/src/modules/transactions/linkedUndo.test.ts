// Excluir pelo extrato um lançamento gerado por outra tela desfaz na origem:
// a parcela da dívida volta a ficar em aberto, a fatura do cartão reabre.
import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { addPurchase, createCard, getStatement, setStatementPaidForUser } from "../cards/cards.service";
import { createDebt, listDebts, setInstallmentPaidForUser } from "../debts/debts.service";
import { findTransactionById } from "./transactions.repository";
import { deleteTransactionsUndoingLinked, deleteTransactionUndoingLinked } from "./linkedUndo";

const month = todayISO().slice(0, 7);

describe("excluir lançamento ligado pelo extrato", () => {
  it("parcela de dívida: o lançamento some e a parcela volta a ficar em aberto", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Nubank",
      description: null,
      totalAmount: 200,
      installmentsCount: 2,
      scope: "personal",
      startMonth: month,
      dueDay: null,
    });
    const [first] = (await listDebts(userAId)).find((d) => d.id === debt.id)!.installments;
    const paid = await setInstallmentPaidForUser(userAId, debt.id, first.id, true);

    await deleteTransactionUndoingLinked(userAId, paid.transactionId!);

    expect(await findTransactionById(paid.transactionId!)).toBeNull();
    const after = (await listDebts(userAId)).find((d) => d.id === debt.id)!;
    expect(after.installments[0]).toMatchObject({ isPaid: false, transactionId: null });
  });

  it("pagamento de fatura: o lançamento some e a fatura reabre (também em lote)", async () => {
    const { userAId } = await createTestGroup();
    const card = await createCard(userAId, {
      name: "Nubank",
      closingDay: 31,
      dueDay: 5,
      scope: "personal",
      limit: null,
      limitType: "normal",
    });
    const [purchase] = await addPurchase(userAId, card.id, {
      description: "Mercado",
      amount: 50,
      categoryId: null,
      buyerId: userAId,
      purchaseDate: todayISO(),
      installments: 1,
    });
    const statement = await setStatementPaidForUser(userAId, card.id, purchase.statementMonth, true);

    const result = await deleteTransactionsUndoingLinked(userAId, [statement.transactionId!]);

    expect(result).toMatchObject({ deleted: 1, skipped: [] });
    expect(await findTransactionById(statement.transactionId!)).toBeNull();
    expect((await getStatement(userAId, card.id, purchase.statementMonth)).isPaid).toBe(false);
  });

});
