// "Passar pra minha conta" (no Par) / "Passar pro grupo" (no Painel): o mesmo
// lançamento troca de conta, sem apagar e lançar de novo.
//   - dinheiro guardado num cartão garantido: quem muda é o cartão (pessoal
//     <-> do grupo), e todos os guardar/resgatar dele vão junto pra conta nova;
//   - o resto passa pela edição normal, que já confere a conta de destino e
//     recusa o que só a tela de origem desfaz (fatura, parcela, reembolso,
//     lista de compras, empréstimo, meta).
import { findAccountForOwner } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { setCardScopeForUser } from "../cards/cards.service";
import { findTransactionById, updateTransaction } from "./transactions.repository";
import { canManageTransaction, InvalidAccountError, TransactionNotFoundError, updateTransactionForUser } from "./transactions.service";

export type MoveTarget = "personal" | "joint";

export async function moveTransactionForUser(userId: string, transactionId: string, to: MoveTarget) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }

  if (transaction.securedCardId) {
    await setCardScopeForUser(userId, transaction.securedCardId, to);
    return (await findTransactionById(transactionId))!;
  }

  const account = await findAccountForOwner(groupId, to === "personal" ? userId : null);
  if (!account) throw new InvalidAccountError();
  if (account.id === transaction.accountId) return transaction;

  const moved = await updateTransactionForUser(userId, transactionId, { accountId: account.id });
  // Na conta pessoal só quem criou mexe: quem passou pra própria conta vira o
  // dono do lançamento (senão o parceiro continuaria editando a conta de outro).
  if (to === "personal" && moved.createdBy !== userId) {
    return updateTransaction(transactionId, { createdBy: userId });
  }
  return moved;
}
