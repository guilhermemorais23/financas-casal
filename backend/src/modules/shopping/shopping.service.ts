import { todayInBrazil } from "../../utils/month";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findUsableAccount } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  prepareTransactionDelete,
  runLedgerTransaction,
  writeNewTransaction,
} from "../transactions/transactions.repository";
import { findItemById, findItemsByGroupId, insertItem, shoppingItemRef } from "./shopping.repository";

export class ItemNotFoundError extends Error {}
export class InvalidAccountError extends Error {}
export class InvalidCategoryError extends Error {}

export async function addItem(userId: string, name: string) {
  const groupId = await requireGroupId(userId);
  return insertItem({ groupId, name, createdBy: userId });
}

export async function listItems(userId: string) {
  const groupId = await requireGroupId(userId);
  return findItemsByGroupId(groupId);
}

async function requireItemInGroup(userId: string, itemId: string) {
  const groupId = await requireGroupId(userId);
  const item = await findItemById(itemId);
  if (!item || item.groupId !== groupId) {
    throw new ItemNotFoundError();
  }
  return { groupId, item };
}

export interface CheckItemInput {
  accountId: string;
  categoryId: string | null;
  amount: number;
}

// Marcar um item da lista é o que vira gasto de verdade -- um item da lista
// não tem preço até alguém comprar, então isto recebe a mesma conta,
// categoria e valor de um lançamento manual. Desmarcar apaga esse gasto de
// novo (o mesmo padrão de lançamento ligado das parcelas de dívida e das
// faturas de cartão no resto do app).
export async function checkItem(userId: string, itemId: string, input: CheckItemInput) {
  const { groupId, item } = await requireItemInGroup(userId, itemId);
  if (item.isChecked) return item;

  const account = await findUsableAccount(groupId, userId, input.accountId);
  if (!account) {
    throw new InvalidAccountError();
  }
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  // Item e gasto mudam juntos (transação do Firestore que relê o item): dois
  // toques não viram dois gastos.
  const ref = shoppingItemRef(itemId);
  await runLedgerTransaction(groupId, async (t) => {
    const current = await t.get(ref);
    if (!current.exists || current.data()!.isChecked) return;
    const transactionId = writeNewTransaction(t, {
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      categoryId: input.categoryId,
      payerId: userId,
      createdBy: userId,
      description: item.name,
      amount: input.amount,
      transactionType: "expense",
      occurredAt: todayInBrazil(),
      isPrivate: false,
      splitType: "none",
      linkKind: "shopping",
    });
    t.update(ref, { isChecked: true, checkedBy: userId, transactionId });
  });
  return (await findItemById(itemId))!;
}

export async function uncheckItem(userId: string, itemId: string) {
  const { groupId, item } = await requireItemInGroup(userId, itemId);
  if (!item.isChecked) return item;
  const ref = shoppingItemRef(itemId);
  await runLedgerTransaction(groupId, async (t) => {
    const current = await t.get(ref);
    if (!current.exists || !current.data()!.isChecked) return;
    const transactionId = current.data()!.transactionId as string | null;
    const removal = transactionId ? await prepareTransactionDelete(t, transactionId) : null;
    removal?.apply();
    t.update(ref, { isChecked: false, checkedBy: null, transactionId: null });
  });
  return (await findItemById(itemId))!;
}

export async function removeItem(userId: string, itemId: string) {
  const { groupId } = await requireItemInGroup(userId, itemId);
  // Item e o gasto dele saem juntos.
  const ref = shoppingItemRef(itemId);
  await runLedgerTransaction(groupId, async (t) => {
    const current = await t.get(ref);
    if (!current.exists) return;
    const transactionId = current.data()!.transactionId as string | null;
    const removal = transactionId ? await prepareTransactionDelete(t, transactionId) : null;
    removal?.apply();
    t.delete(ref);
  });
}
