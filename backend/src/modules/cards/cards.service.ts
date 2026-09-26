import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  deleteTransaction,
  deleteTransactionsBatch,
  findSecuredCardTransferIds,
  findTransactionById,
  insertSplits,
  insertTransaction,
} from "../transactions/transactions.repository";
import { getCreditCardPreference, setCreditCardPreference } from "../users/users.repository";
import { todayInBrazil } from "../loans/loans.service";
import { addMonths, dateForDayInMonth } from "../../utils/month";
import {
  deleteCard,
  deletePurchase,
  deletePurchasesBatch,
  findAllPurchasesByCardId,
  findCardById,
  findCardsVisibleTo,
  findPurchaseById,
  findPurchasesByCardAndStatement,
  findStatement,
  incrementCardLimit,
  setCardSavingsPlan,
  setCardSecuredFromAccount,
  updatePurchasesFields,
  insertCard,
  insertPurchaseSeries,
  setStatementPaid,
  updateCard,
  type CardRow,
  type LimitType,
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
export class NotSecuredCardError extends Error {}
export class InsufficientAvailableLimitError extends Error {}
export class InvalidSavingsPlanError extends Error {}
export class TransactionNotMovableError extends Error {}

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
  limitType: LimitType;
  // Cartão garantido: true = the money leaves the account today (booked as
  // a transfer); false = it was already set aside outside the app, so the
  // limit is extra room and the account isn't touched. Defaults to true.
  securedFromAccount?: boolean;
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
  // One entry per unpaid statement (oldest first): how much of the limit
  // comes back once that fatura is paid, and how much will be free right
  // after -- the "quando o limite volta" timeline. Empty without a limit.
  limitReleases: LimitRelease[];
}

export interface LimitRelease {
  month: string;
  dueDate: string;
  amount: string;
  availableAfter: string;
}

// Every installment (any statement month, including ones months in the
// future) whose statement hasn't been marked paid yet, summed per statement
// month -- a parcelado purchase locks its FULL amount against the limit the
// moment it's made, same as a real card, and only frees each installment's
// share back up as that specific month's fatura gets paid off.
async function computeUnpaidByMonth(cardId: string): Promise<Map<string, number>> {
  const purchases = await findAllPurchasesByCardId(cardId);
  const byMonth = new Map<string, number>();
  if (purchases.length === 0) return byMonth;

  const months = [...new Set(purchases.map((purchase) => purchase.statementMonth))];
  const statements = await Promise.all(months.map((month) => findStatement(cardId, month)));
  const paidMonths = new Set(months.filter((_, index) => statements[index]?.isPaid));

  for (const purchase of purchases) {
    if (paidMonths.has(purchase.statementMonth)) continue;
    const cents = Math.round(Number(purchase.amount) * 100);
    byMonth.set(purchase.statementMonth, (byMonth.get(purchase.statementMonth) ?? 0) + cents);
  }
  return byMonth;
}

function sumCents(byMonth: Map<string, number>): number {
  let total = 0;
  for (const cents of byMonth.values()) total += cents;
  return total;
}

function limitReleasesFor(card: CardRow, byMonth: Map<string, number>): LimitRelease[] {
  let availableCents = Math.round(Number(card.limit) * 100) - sumCents(byMonth);
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, cents]) => {
      availableCents += cents;
      return {
        month,
        dueDate: dueDateFor(month, card.closingDay, card.dueDay),
        amount: (cents / 100).toFixed(2),
        availableAfter: (availableCents / 100).toFixed(2),
      };
    });
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
  // A secured card's limit is the money put into it, so it starts with the
  // first deposit -- there's nothing to track without one.
  if (input.limitType === "secured" && input.limit === null) {
    throw new InvalidLimitError();
  }

  const card = await insertCard({
    groupId,
    ownerUserId,
    createdBy: userId,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    limit: input.limit,
    limitType: input.limitType,
    securedFromAccount: input.securedFromAccount !== false,
  });
  if (card.limitType === "secured" && card.securedFromAccount && input.limit !== null) {
    await recordSecuredTransfer(userId, groupId, card, "deposit", input.limit);
  }
  return card;
}

// The account a card's money moves through -- the owner's personal account
// for a personal card, "Nossa Conta" for a joint one. Same rule the fatura
// payment uses.
async function accountForCard(groupId: string, card: CardRow) {
  const accounts = await findAccountsByGroupId(groupId);
  const account = card.ownerUserId
    ? accounts.find((a) => a.type === "personal" && a.ownerUserId === card.ownerUserId)
    : accounts.find((a) => a.type === "joint");
  if (!account) {
    throw new CardNotFoundError();
  }
  return account;
}

// Guardar no cartão = the money leaves the account (and shows up in the
// extrato on the day it happened); resgatar = it comes back. Booked as a
// transfer (securedCardId), so it moves the balance without counting as a
// gasto/receita anywhere.
async function recordSecuredTransfer(
  userId: string,
  groupId: string,
  card: CardRow,
  direction: "deposit" | "withdraw",
  amount: number
) {
  const account = await accountForCard(groupId, card);
  await insertTransaction({
    groupId,
    accountId: account.id,
    accountType: account.type,
    accountOwnerId: account.ownerUserId,
    categoryId: null,
    payerId: userId,
    createdBy: userId,
    description: direction === "deposit" ? `Guardado no cartão ${card.name}` : `Resgatado do cartão ${card.name}`,
    amount,
    transactionType: direction === "deposit" ? "expense" : "income",
    occurredAt: new Date().toISOString().slice(0, 10),
    isPrivate: false,
    splitType: "none",
    securedCardId: card.id,
  });
}

// Dinheiro parado em cartões com limite garantido -- saiu das contas
// (guardar é uma transferência) mas continua sendo da pessoa.
export function savedInSecuredCardsCents(cards: CardWithSummary[]): number {
  return cards
    .filter((card) => card.limitType === "secured")
    .reduce((sum, card) => sum + Math.round(Number(card.limit ?? 0) * 100), 0);
}

// O que ainda vai sair das contas pra pagar os cartões: tudo que está em
// aberto quando o cartão tem limite (inclusive parcelas de meses futuros),
// senão só a fatura atual se ainda não foi paga.
export function owedOnCardsCents(cards: CardWithSummary[]): number {
  return cards.reduce((sum, card) => {
    if (card.limitUsed !== null) return sum + Math.round(Number(card.limitUsed) * 100);
    const statement = card.currentStatement;
    return statement.isPaid ? sum : sum + Math.round(Number(statement.total) * 100);
  }, 0);
}

export async function listCards(userId: string): Promise<CardWithSummary[]> {
  const groupId = await requireGroupId(userId);
  const cards = await findCardsVisibleTo(groupId, userId);

  return Promise.all(
    cards.map(async (card) => {
      const month = currentStatementMonth(card.closingDay);
      const [purchases, statement, unpaidByMonth] = await Promise.all([
        findPurchasesByCardAndStatement(card.id, month),
        findStatement(card.id, month),
        card.limit !== null ? computeUnpaidByMonth(card.id) : Promise.resolve(null),
      ]);
      return {
        ...card,
        scope: card.ownerUserId ? "personal" : ("joint" as CardScope),
        currentStatement: summarizePurchases(card, month, purchases, statement?.isPaid ?? false),
        limitUsed: unpaidByMonth !== null ? (sumCents(unpaidByMonth) / 100).toFixed(2) : null,
        limitReleases: unpaidByMonth !== null ? limitReleasesFor(card, unpaidByMonth) : [],
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

    const account = await accountForCard(groupId, card);

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
  const { card } = await requireManageableCard(userId, cardId);
  if (input.limit !== undefined && input.limit !== null && input.limit <= 0) {
    throw new InvalidLimitError();
  }
  // A secured card's limit only moves through deposits/withdrawals, so its
  // history always matches the money actually parked in it.
  if (card.limitType === "secured" && input.limit !== undefined) {
    throw new NotSecuredCardError();
  }
  return updateCard(cardId, input);
}

// Cartão com limite garantido: "Guardar mais" raises the limit by exactly
// the money deposited; "Resgatar" lowers it, but only up to what purchases
// aren't holding -- the rest stays locked until those faturas are paid,
// same as the bank would do.
export async function adjustSecuredLimit(
  userId: string,
  cardId: string,
  input: { direction: "deposit" | "withdraw"; amount: number }
) {
  const { groupId, card } = await requireManageableCard(userId, cardId);
  if (card.limitType !== "secured") {
    throw new NotSecuredCardError();
  }
  if (!(input.amount > 0)) {
    throw new InvalidLimitError();
  }

  const amountCents = Math.round(input.amount * 100);
  if (input.direction === "withdraw") {
    const availableCents = Math.round(Number(card.limit ?? 0) * 100) - sumCents(await computeUnpaidByMonth(cardId));
    if (amountCents > availableCents) {
      throw new InsufficientAvailableLimitError();
    }
  }
  const updated = await incrementCardLimit(
    cardId,
    input.direction === "deposit" ? amountCents : -amountCents,
    input.direction === "deposit" ? todayInBrazil().slice(0, 7) : undefined
  );
  if (card.securedFromAccount) {
    await recordSecuredTransfer(userId, groupId, card, input.direction, amountCents / 100);
  }
  return updated;
}

// "Esse dinheiro saiu da minha conta?" -- fixable after the fact. Turning it
// off drops every guardar/resgatar entry from the extrato (the account goes
// back to what it was, the limit stays); turning it on books the money
// currently parked in the card as one guardar today.
export async function setSecuredSourceForUser(userId: string, cardId: string, fromAccount: boolean) {
  const { groupId, card } = await requireManageableCard(userId, cardId);
  if (card.limitType !== "secured") {
    throw new NotSecuredCardError();
  }
  if (card.securedFromAccount === fromAccount) return card;

  if (fromAccount) {
    const parked = Number(card.limit ?? 0);
    if (parked > 0) {
      await recordSecuredTransfer(userId, groupId, card, "deposit", parked);
    }
  } else {
    await deleteTransactionsBatch(await findSecuredCardTransferIds(cardId));
  }
  return setCardSecuredFromAccount(cardId, fromAccount);
}

export async function removeCard(userId: string, cardId: string) {
  await requireManageableCard(userId, cardId);
  // Whatever was still guardado in the card goes back to the account: its
  // guardar/resgatar entries disappear along with the card.
  const transferIds = await findSecuredCardTransferIds(cardId);
  const linkedTransactionIds = await deleteCard(cardId);
  await Promise.all(linkedTransactionIds.map((transactionId) => deleteTransaction(transactionId)));
  await deleteTransactionsBatch(transferIds);
}

// Editar uma compra: descrição, categoria e quem comprou valem pra todas as
// parcelas dela. Valor, data e parcelas refazem a compra inteira -- só dá
// enquanto nenhuma fatura com parcela dela foi paga.
export async function updatePurchase(userId: string, cardId: string, purchaseId: string, input: AddPurchaseInput) {
  const { groupId, card } = await requireManageableCard(userId, cardId);
  const purchase = await findPurchaseById(cardId, purchaseId);
  if (!purchase) {
    throw new PurchaseNotFoundError();
  }
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

  const series = (await findAllPurchasesByCardId(cardId)).filter((p) => p.purchaseGroupId === purchase.purchaseGroupId);
  const seriesTotalCents = series.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
  const moneyChanged =
    Math.round(input.amount * 100) !== seriesTotalCents ||
    input.purchaseDate !== purchase.purchaseDate ||
    input.installments !== purchase.installmentsCount;

  if (!moneyChanged) {
    await updatePurchasesFields(
      cardId,
      series.map((p) => p.id),
      { description: input.description, categoryId: input.categoryId, buyerId: input.buyerId }
    );
    return (await findAllPurchasesByCardId(cardId)).filter((p) => p.purchaseGroupId === purchase.purchaseGroupId);
  }

  const statements = await Promise.all(series.map((p) => findStatement(cardId, p.statementMonth)));
  const newFirstMonth = statementMonthFor(input.purchaseDate, card.closingDay);
  const newFirstStatement = await findStatement(cardId, newFirstMonth);
  if (statements.some((statement) => statement?.isPaid) || newFirstStatement?.isPaid) {
    throw new StatementAlreadyPaidError();
  }
  await deletePurchasesBatch(
    cardId,
    series.map((p) => p.id)
  );
  return addPurchase(userId, cardId, input);
}

// "Mover pro cartão": uma despesa que foi no crédito mas entrou como gasto
// normal na conta vira compra do cartão (sai da conta só quando a fatura for
// paga). A despesa original some.
export async function moveTransactionToCard(
  userId: string,
  cardId: string,
  input: { transactionId: string; installments: number }
) {
  const { groupId } = await requireManageableCard(userId, cardId);
  const transaction = await findTransactionById(input.transactionId);
  const canManage = transaction && (transaction.accountType === "joint" || transaction.createdBy === userId);
  if (!transaction || transaction.groupId !== groupId || !canManage) {
    throw new TransactionNotMovableError("not_found");
  }
  if (transaction.transactionType !== "expense" || transaction.securedCardId || transaction.loanId) {
    throw new TransactionNotMovableError("not_expense");
  }
  if (transaction.isSettled) {
    throw new TransactionNotMovableError("settled");
  }

  const purchases = await addPurchase(userId, cardId, {
    description: transaction.description,
    amount: Number(transaction.amount),
    categoryId: transaction.categoryId,
    buyerId: transaction.payerId,
    purchaseDate: transaction.occurredAt,
    installments: input.installments,
  });
  await deleteTransactionsBatch([transaction.id]);
  return purchases;
}

export async function getCreditCardPreferenceForUser(userId: string): Promise<string | null> {
  const [preference, cards] = await Promise.all([getCreditCardPreference(userId), listCardsLite(userId)]);
  if (preference === "none") return "none";
  return preference && cards.some((card) => card.id === preference) ? preference : null;
}

export async function setCreditCardPreferenceForUser(userId: string, value: string | null) {
  if (value !== null && value !== "none") {
    const cards = await listCardsLite(userId);
    if (!cards.some((card) => card.id === value)) {
      throw new CardNotFoundError();
    }
  }
  await setCreditCardPreference(userId, value);
  return value;
}

async function listCardsLite(userId: string) {
  const groupId = await requireGroupId(userId);
  return findCardsVisibleTo(groupId, userId);
}

// "Guardar todo mês" num cartão garantido. null tira o plano.
export async function setSavingsPlanForUser(userId: string, cardId: string, plan: { amount: number; day: number } | null) {
  const { card } = await requireManageableCard(userId, cardId);
  if (card.limitType !== "secured") {
    throw new NotSecuredCardError();
  }
  if (plan && (!(plan.amount > 0) || !Number.isInteger(plan.day) || plan.day < 1 || plan.day > 31)) {
    throw new InvalidSavingsPlanError();
  }
  return setCardSavingsPlan(cardId, plan);
}

// Próxima vez de guardar: neste mês, se ainda não guardou; senão no próximo.
export function nextSavingsDate(card: CardRow, today: string): string | null {
  if (card.limitType !== "secured" || !card.savingsPlan) return null;
  const thisMonth = today.slice(0, 7);
  const month = card.lastDepositMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
  return dateForDayInMonth(month, card.savingsPlan.day);
}
