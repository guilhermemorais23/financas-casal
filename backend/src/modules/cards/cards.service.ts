import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransaction, insertSplits, insertTransaction } from "../transactions/transactions.repository";
import { addMonths, dateForDayInMonth } from "../../utils/month";
import {
  deleteCard,
  deletePurchase,
  findAllPurchasesByCardId,
  findCardById,
  findCardsVisibleTo,
  findPurchaseById,
  findPurchasesByCardAndStatement,
  findStatement,
  insertCard,
  insertPurchaseSeries,
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
export class InvalidLimitError extends Error {}
export class InvalidInstallmentsError extends Error {}

export type CardScope = "personal" | "joint";

// Whatever the purchase form offers -- 1x through 12x, but only a curated
// set of "round" counts (matches how a card statement itself would phrase
// it), not every integer in between. Enforced here too, not just as a
// frontend <select> affordance, so the API contract actually says what's
// allowed.
export const ALLOWED_INSTALLMENT_COUNTS = [1, 2, 3, 4, 6, 12];

export interface CreateCardInput {
  name: string;
  closingDay: number;
  dueDay: number;
  scope: CardScope;
  limit: number | null;
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
  // Only computed when the card actually has a limit -- a card without one
  // does the extra findAllPurchasesByCardId + per-month statement reads for
  // nothing, and the frontend has nothing to draw a bar against anyway.
  limitUsed: string | null;
}

// Sum of every installment (any statement month, including ones months in
// the future) whose statement hasn't been marked paid yet -- a parcelado
// purchase locks its FULL amount against the limit the moment it's made,
// same as a real card, and only frees each installment's share back up as
// that specific month's fatura gets paid off.
async function computeLimitUsed(cardId: string): Promise<number> {
  const purchases = await findAllPurchasesByCardId(cardId);
  if (purchases.length === 0) return 0;

  const months = [...new Set(purchases.map((purchase) => purchase.statementMonth))];
  const statements = await Promise.all(months.map((month) => findStatement(cardId, month)));
  const paidMonths = new Set(months.filter((_, index) => statements[index]?.isPaid));

  return purchases
    .filter((purchase) => !paidMonths.has(purchase.statementMonth))
    .reduce((sum, purchase) => sum + Math.round(Number(purchase.amount) * 100), 0);
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
// dueDay is clamped to the target month's real last day -- a card set to
// due on the 31st (allowed at creation: any 1-31) would otherwise produce a
// calendar-invalid string like "2026-04-31" every April/June/September/
// November/February, which broke the Painel's new "vence em X dias" label
// silently (JS's Date rolls an invalid day into the next month instead of
// throwing, so the countdown/urgency styling was computed against the
// wrong date). Same clamp rule dateForDayInMonth already uses for debts.
export function dueDateFor(statementMonth: string, closingDay: number, dueDay: number): string {
  const targetMonth = dueDay > closingDay ? statementMonth : addMonths(statementMonth, 1);
  return dateForDayInMonth(targetMonth, dueDay);
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

  if (input.limit !== null && input.limit <= 0) {
    throw new InvalidLimitError();
  }

  return insertCard({
    groupId,
    ownerUserId,
    createdBy: userId,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    limit: input.limit,
  });
}

export async function listCards(userId: string): Promise<CardWithSummary[]> {
  const groupId = await requireGroupId(userId);
  const cards = await findCardsVisibleTo(groupId, userId);

  return Promise.all(
    cards.map(async (card) => {
      const month = currentStatementMonth(card.closingDay);
      const [purchases, statement, limitUsedCents] = await Promise.all([
        findPurchasesByCardAndStatement(card.id, month),
        findStatement(card.id, month),
        card.limit !== null ? computeLimitUsed(card.id) : Promise.resolve(null),
      ]);
      return {
        ...card,
        scope: card.ownerUserId ? "personal" : ("joint" as CardScope),
        currentStatement: summarizePurchases(card, month, purchases, statement?.isPaid ?? false),
        limitUsed: limitUsedCents !== null ? (limitUsedCents / 100).toFixed(2) : null,
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
  // 1 = à vista (the default, and the only option before parcelamento
  // existed) -- anything else generates that many installments, one per
  // consecutive statement month starting from this purchase's own.
  installments: number;
}

export async function addPurchase(userId: string, cardId: string, input: AddPurchaseInput) {
  const { groupId, card } = await requireManageableCard(userId, cardId);

  if (!ALLOWED_INSTALLMENT_COUNTS.includes(input.installments)) {
    throw new InvalidInstallmentsError();
  }

  const members = await findMembersByGroupId(groupId);
  if (!members.some((member) => member.id === input.buyerId)) {
    throw new InvalidBuyerError();
  }
  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  const firstStatementMonth = statementMonthFor(input.purchaseDate, card.closingDay);
  const statement = await findStatement(cardId, firstStatementMonth);
  if (statement?.isPaid) {
    throw new StatementAlreadyPaidError();
  }

  const statementMonths = Array.from({ length: input.installments }, (_, index) =>
    addMonths(firstStatementMonth, index)
  );

  return insertPurchaseSeries(
    cardId,
    {
      description: input.description,
      amount: input.amount,
      categoryId: input.categoryId,
      buyerId: input.buyerId,
      purchaseDate: input.purchaseDate,
      count: input.installments,
    },
    statementMonths
  );
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
  input: { name: string; closingDay: number; dueDay: number; limit?: number | null }
) {
  await requireManageableCard(userId, cardId);
  if (input.limit !== undefined && input.limit !== null && input.limit <= 0) {
    throw new InvalidLimitError();
  }
  return updateCard(cardId, input);
}

export async function removeCard(userId: string, cardId: string) {
  await requireManageableCard(userId, cardId);
  const linkedTransactionIds = await deleteCard(cardId);
  await Promise.all(linkedTransactionIds.map((transactionId) => deleteTransaction(transactionId)));
}
