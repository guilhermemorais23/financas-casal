// Excluir pelo extrato um lançamento que outra tela criou, desfazendo na
// origem -- assim nada fica desencontrado:
//   - parcela de dívida paga -> a parcela volta a ficar em aberto;
//   - pagamento de fatura    -> a fatura volta a ficar aberta.
// Os dois "desmarcar" já apagam o próprio lançamento. Reembolso e lista de
// compras continuam bloqueados (LinkedTransactionError com onde desfazer).
// Fica fora do transactions.service porque usa dívidas e cartões, que já
// dependem dele (evita import circular).
import { findCardsByGroupId, findStatementsByCardId } from "../cards/cards.repository";
import { setStatementPaidForUser } from "../cards/cards.service";
import { findDebtsByGroupId, findInstallmentsByDebtIds } from "../debts/debts.repository";
import { setInstallmentPaidForUser } from "../debts/debts.service";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransactionForUser, deleteTransactionsForUser, LinkedTransactionError } from "./transactions.service";

type UndoableKind = "debt_installment" | "card_statement";

function isUndoable(kind: string): kind is UndoableKind {
  return kind === "debt_installment" || kind === "card_statement";
}

// Devolve true se achou a origem e desfez.
async function undoAtSource(userId: string, transactionId: string, kind: UndoableKind): Promise<boolean> {
  const groupId = await requireGroupId(userId);
  if (kind === "debt_installment") {
    const debts = await findDebtsByGroupId(groupId);
    const installments = debts.length > 0 ? await findInstallmentsByDebtIds(debts.map((debt) => debt.id)) : [];
    const installment = installments.find((row) => row.transactionId === transactionId);
    if (!installment) return false;
    await setInstallmentPaidForUser(userId, installment.debtId, installment.id, false);
    return true;
  }
  for (const card of await findCardsByGroupId(groupId)) {
    const statements = await findStatementsByCardId(card.id);
    for (const [month, statement] of statements) {
      if (statement.transactionId === transactionId) {
        await setStatementPaidForUser(userId, card.id, month, false);
        return true;
      }
    }
  }
  return false;
}

export async function deleteTransactionUndoingLinked(userId: string, transactionId: string): Promise<void> {
  try {
    await deleteTransactionForUser(userId, transactionId);
  } catch (err) {
    if (err instanceof LinkedTransactionError && isUndoable(err.kind) && (await undoAtSource(userId, transactionId, err.kind))) {
      return;
    }
    throw err;
  }
}

export async function deleteTransactionsUndoingLinked(userId: string, transactionIds: string[]) {
  const result = await deleteTransactionsForUser(userId, transactionIds);
  const skipped: typeof result.skipped = [];
  let deleted = result.deleted;
  // Em sequência: duas parcelas da mesma dívida não disputam a mesma leitura.
  for (const row of result.skipped) {
    if (isUndoable(row.reason) && (await undoAtSource(userId, row.id, row.reason))) {
      deleted += 1;
    } else {
      skipped.push(row);
    }
  }
  return { deleted, skipped };
}
