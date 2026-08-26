import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransaction, insertTransaction } from "../transactions/transactions.repository";
import {
  deleteItem,
  findItemById,
  findItemsByGroupId,
  insertItem,
  setItemChecked,
} from "./shopping.repository";

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

// Checking an item off the list is what turns it into a real expense -- a
// shopping-list entry has no price until someone actually buys it, so this
// takes the same account/category/amount a manual transaction would.
// Unchecking removes that expense again (same linked-transaction pattern as
// debt installments and card statements elsewhere in this app).
export async function checkItem(userId: string, itemId: string, input: CheckItemInput) {
  const { groupId, item } = await requireItemInGroup(userId, itemId);
  if (item.isChecked) return item;

  const accounts = await findAccountsByGroupId(groupId);
  const account = accounts.find((a) => a.id === input.accountId);
  if (!account) {
    throw new InvalidAccountError();
  }
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  const transaction = await insertTransaction({
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
    occurredAt: new Date().toISOString().slice(0, 10),
    isPrivate: false,
    splitType: "none",
  });

  return setItemChecked(itemId, true, userId, transaction.id);
}

export async function uncheckItem(userId: string, itemId: string) {
  const { item } = await requireItemInGroup(userId, itemId);
  if (!item.isChecked) return item;
  if (item.transactionId) {
    await deleteTransaction(item.transactionId);
  }
  return setItemChecked(itemId, false, null, null);
}

export async function removeItem(userId: string, itemId: string) {
  const { item } = await requireItemInGroup(userId, itemId);
  if (item.transactionId) {
    await deleteTransaction(item.transactionId);
  }
  await deleteItem(itemId);
}
