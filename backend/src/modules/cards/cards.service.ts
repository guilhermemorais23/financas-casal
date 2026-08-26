import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransaction, insertSplits, insertTransaction } from "../transactions/transactions.repository";
import { addMonths } from "../../utils/month";
import {
  deleteCard,
  deletePurchase,
  findCardById,
  findCardsVisibleTo,
  findPurchaseById,
  findPurchasesByCardAndStatement,
  findStatement,
  insertCard,
  insertPurchase,
  setStatementPaid,
  updateCard,
  type CardRow,
  type PurchaseRow,
} from "./cards.repository";

export class CardNotFoundError extends Error {}
export class PurchaseNotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class InvalidBuyerError extends Error {}
export class InvalidCategoryError extends Error {}
export class StatementAlreadyPaidError extends Error {}

export type CardScope = "personal" | "joint";

export interface CreateCardInput {
  name: string;
  closingDay: number;
  dueDay: number;
  scope: CardScope;
}

export interface CardStatementSummary {
  month: string;
  dueDate: string;
  total: string;
  isPaid: boolean;
  byPerson: { userId: string; total: string }[];
}

export interface CardWithSummary extends CardRow {
  scope: CardScope;
  currentStatement: CardStatementSummary;
}

// Purchases on days 1..closingDay belong to the statement labeled with that
// same month; purchases after closingDay roll into next month's statement --
// mirrors how a real card's cycle works, regardless of which day someone
// actually adds the purchase.
function statementMonthFor(purchaseDate: string, closingDay: number): string {
  const [year, month, day] = purchaseDate.split("-").map(Number);
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  return day <= closingDay ? monthParam : addMonths(monthParam, 1);
}

// Exported for the same reason as dueDateFor below.
export function currentStatementMonth(closingDay: number): string {
  return statementMonthFor(new Date().toISOString().slice(0, 10), closingDay);
}

// dueDay is normally earlier in the calendar than closingDay (closes the
// 28th, due the 5th of the following month) but a same-month cycle is
// possible too (closes the 5th, due the 12th) -- compare the two days to
// know which month the due date actually falls in.
// Exported: the reminders job (outside any per-user request) needs this
// same due-date math to know when a card's current statement is coming due.
export function dueDateFor(statementMonth: string, closingDay: number, dueDay: number): string {
  const targetMonth = dueDay > closingDay ? statementMonth : addMonths(statementMonth, 1);
  return `${targetMonth}-${String(dueDay).padStart(2, "0")}`;
}

function summarizePurchases(
  card: CardRow,
  month: string,
  purchases: PurchaseRow[],
  isPaid: boolean
): CardStatementSummary {
  const totalCents = purchases.reduce((sum, purchase) => sum + Math.round(Number(purchase.amount) * 100), 0);
  const byPersonMap = new Map<string, number>();
  for (const purchase of purchases) {
    const cents = Math.round(Number(purchase.amount) * 100);
    byPersonMap.set(purchase.buyerId, (byPersonMap.get(purchase.buyerId) ?? 0) + cents);
  }
  return {
    month,
    dueDate: dueDateFor(month, card.closingDay, card.dueDay),
    total: (totalCents / 100).toFixed(2),
    isPaid,
    byPerson: Array.from(byPersonMap.entries()).map(([userId, cents]) => ({
      userId,
      total: (cents / 100).toFixed(2),
    })),
  };
}

export async function createCard(userId: string, input: CreateCardInput) {
  const groupId = await requireGroupId(userId);
  const ownerUserId = input.scope === "joint" ? null : userId;

  return insertCard({
    groupId,
    ownerUserId,
    createdBy: userId,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
  });
}

export async function listCards(userId: string): Promise<CardWithSummary[]> {
  const groupId = await requireGroupId(userId);
  const cards = await findCardsVisibleTo(groupId, userId);

  return Promise.all(
    cards.map(async (card) => {
      const month = currentStatementMonth(card.closingDay);
      const [purchases, statement] = await Promise.all([
        findPurchasesByCardAndStatement(card.id, month),
        findStatement(card.id, month),
      ]);
      return {
        ...card,
        scope: card.ownerUserId ? "personal" : ("joint" as CardScope),
        currentStatement: summarizePurchases(card, month, purchases, statement?.isPaid ?? false),
      };
    })
  );
}

async function requireManageableCard(userId: string, cardId: string) {
  const groupId = await requireGroupId(userId);
  const card = await findCardById(cardId);
  if (!card || card.groupId !== groupId) {
    throw new CardNotFoundError();
  }
  if (card.ownerUserId && card.ownerUserId !== userId) {
    throw new ForbiddenError();
  }
  return { groupId, card };
}

export interface AddPurchaseInput {
  description: string;
  amount: number;
  categoryId: string | null;
  buyerId: string;
  purchaseDate: string;
}

export async function addPurchase(userId: string, cardId: string, input: AddPurchaseInput) {
  const { groupId, card } = await requireManageableCard(userId, cardId);

  const members = await findMembersByGroupId(groupId);
  if (!members.some((member) => member.id === input.buyerId)) {
    throw new InvalidBuyerError();
  }
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  const statementMonth = statementMonthFor(input.purchaseDate, card.closingDay);
  const statement = await findStatement(cardId, statementMonth);
  if (statement?.isPaid) {
    throw new StatementAlreadyPaidError();
  }

  return insertPurchase(cardId, {
    description: input.description,
    amount: input.amount,
    categoryId: input.categoryId,
    buyerId: input.buyerId,
    purchaseDate: input.purchaseDate,
    statementMonth,
  });
}

export async function removePurchase(userId: string, cardId: string, purchaseId: string) {
  await requireManageableCard(userId, cardId);
  const purchase = await findPurchaseById(cardId, purchaseId);
  if (!purchase) {
    throw new PurchaseNotFoundError();
  }
  const statement = await findStatement(cardId, purchase.statementMonth);
  if (statement?.isPaid) {
    throw new StatementAlreadyPaidError();
  }
  await deletePurchase(cardId, purchaseId);
}

export async function getStatement(userId: string, cardId: string, month?: string) {
  const { card } = await requireManageableCard(userId, cardId);
  const statementMonth = month ?? currentStatementMonth(card.closingDay);
  const [purchases, statement] = await Promise.all([
    findPurchasesByCardAndStatement(cardId, statementMonth),
    findStatement(cardId, statementMonth),
  ]);
  return {
    ...summarizePurchases(card, statementMonth, purchases, statement?.isPaid ?? false),
    purchases,
  };
}

// Same idea as debt installments: paying a fatura logs one real expense
// against the card's account, split per person by what they actually
// bought (not divided evenly) -- whoever marks it paid is the payer, and
// the splits are what feeds "who owes whom" for everyone else's share.
export async function setStatementPaidForUser(
  userId: string,
  cardId: string,
  month: string,
  isPaid: boolean
) {
  const { groupId, card } = await requireManageableCard(userId, cardId);
  const existing = await findStatement(cardId, month);

  if (isPaid && !existing?.isPaid) {
    const purchases = await findPurchasesByCardAndStatement(cardId, month);
    if (purchases.length === 0) {
      throw new PurchaseNotFoundError();
    }

    const accounts = await findAccountsByGroupId(groupId);
    const account = card.ownerUserId
      ? accounts.find((a) => a.type === "personal" && a.ownerUserId === card.ownerUserId)
      : accounts.find((a) => a.type === "joint");
    if (!account) {
      throw new CardNotFoundError();
    }

    const totalAmount = purchases.reduce((sum, purchase) => sum + Number(purchase.amount), 0);
    const transaction = await insertTransaction({
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      categoryId: null,
      payerId: userId,
      createdBy: userId,
      description: `Fatura ${card.name} — ${month}`,
      amount: totalAmount,
      transactionType: "expense",
      occurredAt: dueDateFor(month, card.closingDay, card.dueDay),
      isPrivate: false,
      splitType: "custom",
    });

    const byBuyerCents = new Map<string, number>();
    for (const purchase of purchases) {
      const cents = Math.round(Number(purchase.amount) * 100);
      byBuyerCents.set(purchase.buyerId, (byBuyerCents.get(purchase.buyerId) ?? 0) + cents);
    }
    await insertSplits(
      groupId,
      transaction.id,
      Array.from(byBuyerCents.entries()).map(([userId2, shareAmountCents]) => ({
        userId: userId2,
        shareAmountCents,
      }))
    );

    return setStatementPaid(cardId, month, true, transaction.id);
  }

  if (!isPaid && existing?.isPaid) {
    if (existing.transactionId) {
      await deleteTransaction(existing.transactionId);
    }
    return setStatementPaid(cardId, month, false, null);
  }

  return existing ?? { isPaid: false, paidAt: null, transactionId: null };
}

export async function updateCardForUser(
  userId: string,
  cardId: string,
  input: { name: string; closingDay: number; dueDay: number }
) {
  await requireManageableCard(userId, cardId);
  return updateCard(cardId, input);
}

export async function removeCard(userId: string, cardId: string) {
  await requireManageableCard(userId, cardId);
  const linkedTransactionIds = await deleteCard(cardId);
  await Promise.all(linkedTransactionIds.map((transactionId) => deleteTransaction(transactionId)));
}
