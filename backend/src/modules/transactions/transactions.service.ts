import { FieldValue } from "firebase-admin/firestore";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findDebtsByGroupId, findInstallmentsByDebtIds } from "../debts/debts.repository";
import { findMembersByGroupId, findUsableAccount, type MemberRow } from "../groups/groups.repository";
import { isShoppingTransaction } from "../shopping/shopping.repository";
import { requireGroupId } from "../groups/groups.service";
import { addMonths, addMonthsToDate, parseMonthRange, todayInBrazil } from "../../utils/month";
import { fromCents, splitEvenly, toCents } from "../../utils/money";
import {
  deleteTransaction,
  deleteTransactionsBatch,
  findOwnDocsForRange,
  findRecurringSeries,
  findTransactionById,
  findTransactionsVisibleTo,
  getBalanceRows,
  getDailySeries,
  getMonthlySummary,
  getYearlySummary,
  insertTransactionSeries,
  isSettlementTransaction,
  prepareTransactionDelete,
  runLedgerTransaction,
  transactionDocRef,
  updateTransaction,
  writeNewTransaction,
  type LinkKind,
  type PaymentMethod,
  type SplitInput,
  type SplitType,
  type SummaryScope,
  type TransactionRow,
  type TransactionType,
} from "./transactions.repository";

export { InvalidMonthError } from "../../utils/month";
export class InvalidAccountError extends Error {}
export class InvalidPayerError extends Error {}
export class InvalidCategoryError extends Error {}
export class UnsupportedSplitTypeError extends Error {}
export class TransactionNotFoundError extends Error {}
export class InvalidRecurrenceError extends Error {}
// Guardar/resgatar de um cartão com limite garantido -- only changes from the
// card itself, so the card's limit and the account never disagree.
export class SecuredCardTransferError extends Error {}
// Lançamento criado por outra tela (fatura paga, parcela, reembolso, lista de
// compras): só dá pra desfazer por lá.
export class LinkedTransactionError extends Error {
  constructor(readonly kind: LinkKind) {
    super(kind);
  }
}

// Divisão igual entre todo mundo do grupo (o centavo que sobra vai pros
// primeiros). Sozinho no grupo não há divisão: undefined (nas edições, deixa
// as divisões que já existiam como estão).
function equalSplits(amount: number, members: MemberRow[]): SplitInput[] | undefined {
  if (members.length < 2) return undefined;
  const shares = splitEvenly(amount, members.length);
  return members.map((member, index) => ({ userId: member.id, shareAmountCents: shares[index] }));
}

// De qual tela veio o lançamento (null = lançamento normal). Os novos trazem
// linkKind; os de antes dele são reconhecidos procurando quem aponta pra ele.
export async function linkKindOf(groupId: string, transaction: TransactionRow): Promise<LinkKind | null> {
  if (transaction.linkKind) return transaction.linkKind;
  // Só o pagamento de fatura usa divisão "custom".
  if (transaction.splitType === "custom") return "card_statement";
  const [settlement, shopping, installment] = await Promise.all([
    isSettlementTransaction(transaction.id),
    isShoppingTransaction(transaction.id),
    findDebtsByGroupId(groupId).then(async (debts) =>
      debts.length === 0
        ? false
        : (await findInstallmentsByDebtIds(debts.map((debt) => debt.id))).some((i) => i.transactionId === transaction.id)
    ),
  ]);
  if (settlement) return "settlement";
  if (shopping) return "shopping";
  if (installment) return "debt_installment";
  return null;
}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

// A recurring series is generated whole at creation time (no cron): 2
// occurrences is the smallest thing worth calling "recurring" at all, 36
// (3 years of a subscription/rent) is a sane upper bound so nobody fat-fingers
// a 4-digit month count into a Firestore batch write.
export const MIN_RECURRENCE_MONTHS = 2;
export const MAX_RECURRENCE_MONTHS = 36;

export interface CreateTransactionInput {
  accountId: string;
  categoryId: string | null;
  payerId: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
  paymentMethod?: PaymentMethod | null;
  // When set, generates `months` occurrences (this one plus months-1 more,
  // one per month, same day-of-month clamped to shorter months) in one go
  // instead of just this single transaction.
  recurring?: { months: number };
}

export async function createTransaction(userId: string, input: CreateTransactionInput) {
  const groupId = await requireGroupId(userId);

  const [account, members] = await Promise.all([
    findUsableAccount(groupId, userId, input.accountId),
    findMembersByGroupId(groupId),
  ]);
  if (!account) {
    throw new InvalidAccountError();
  }

  if (!members.some((member) => member.id === input.payerId)) {
    throw new InvalidPayerError();
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  if (!SUPPORTED_SPLIT_TYPES.includes(input.splitType)) {
    throw new UnsupportedSplitTypeError();
  }

  let occurredAtDates = [input.occurredAt];
  if (input.recurring) {
    const { months } = input.recurring;
    if (!Number.isInteger(months) || months < MIN_RECURRENCE_MONTHS || months > MAX_RECURRENCE_MONTHS) {
      throw new InvalidRecurrenceError();
    }
    occurredAtDates = Array.from({ length: months }, (_, index) => addMonthsToDate(input.occurredAt, index));
  }

  const transactions = await insertTransactionSeries(
    {
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      categoryId: input.categoryId,
      payerId: input.payerId,
      createdBy: userId,
      description: input.description,
      amount: input.amount,
      transactionType: input.transactionType,
      isPrivate: input.isPrivate,
      splitType: input.splitType,
      paymentMethod: input.paymentMethod ?? null,
    },
    occurredAtDates,
    // Splits model who owes whom on a shared expense; income has no such debt.
    // Divides evenly across however many members the group actually has. Every
    // occurrence of a recurring series gets its own splits, same as a one-off.
    (input.transactionType === "expense" && input.splitType === "equal" ? equalSplits(input.amount, members) : undefined) ?? []
  );

  return transactions[0];
}

export async function listTransactions(
  userId: string,
  limit: number,
  monthParam?: string,
  accountId?: string
) {
  const groupId = await requireGroupId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(groupId, userId, limit, range, accountId);
}

// Same visibility rules as the normal list -- export never leaks a
// groupmate's private personal transaction either. 10k is far above what
// any group would have in a single month; a hard cap just protects the
// export from growing unbounded if someone ever calls it without a month.
export async function exportTransactionsForUser(userId: string, monthParam?: string) {
  const groupId = await requireGroupId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(groupId, userId, 10000, range);
}

// Pairwise "who owes whom" across every member pair with a shared-expense
// debt. Not currently surfaced in any UI page.
export async function getBalance(userId: string) {
  const groupId = await requireGroupId(userId);
  const rows = await getBalanceRows(groupId);

  const netByPair = new Map<string, number>();
  for (const row of rows) {
    const [a, b] = [row.paidBy, row.owedBy].sort();
    const sign = a === row.paidBy ? 1 : -1;
    const key = `${a}_${b}`;
    netByPair.set(key, (netByPair.get(key) ?? 0) + sign * Number(row.totalOwed));
  }

  const balances = Array.from(netByPair.entries()).map(([key, amount]) => {
    const [a, b] = key.split("_");
    return amount >= 0 ? { fromUserId: b, toUserId: a, amount } : { fromUserId: a, toUserId: b, amount: -amount };
  });

  return { balances };
}

export async function getMonthlySummaryForUser(userId: string, monthParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const { periodMonth, monthStart, monthEnd } = parseMonthRange(monthParam);
  const summary = await getMonthlySummary(groupId, userId, monthStart, monthEnd, scope);
  return { periodMonth, ...summary };
}

export async function getDailySeriesForUser(userId: string, monthParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const { monthStart, monthEnd } = parseMonthRange(monthParam);
  return getDailySeries(groupId, userId, monthStart, monthEnd, scope);
}

export class InvalidYearError extends Error {}

export async function getYearlySummaryForUser(userId: string, yearParam?: string, scope?: SummaryScope) {
  const groupId = await requireGroupId(userId);
  const year = yearParam ? Number(yearParam) : new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new InvalidYearError();
  }
  return getYearlySummary(groupId, userId, year, scope);
}

export interface MonthlyTrendPoint {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
  // Net money moved from the personal account into cartões com limite
  // garantido this month (deposits minus resgates) -- not an expense, but it
  // did leave the account, so the hero number subtracts it while "Saída do
  // mês" and every report leave it out.
  savedInCards: number;
  // Mesma ideia pros Empréstimos: quanto saiu emprestado no mês (emprestado
  // menos recebido de volta).
  lentOut: number;
  net: number;
}

// One query covers three things the Painel needs: the 6-month trend line,
// AND (since the window always includes the current and previous month)
// this month's and last month's income/expense totals -- what used to take
// two more separate fetches of up to 100 full transaction rows each, just
// to sum two numbers each. Personal scope on purpose: matches exactly what
// the hero number above it ("Você tem no mês") already means, so the two
// never disagree.
export async function getMonthlyTrendForUser(
  userId: string,
  monthParam?: string,
  monthsBack = 6
): Promise<MonthlyTrendPoint[]> {
  const groupId = await requireGroupId(userId);
  const { periodMonth } = parseMonthRange(monthParam);
  const endMonth = periodMonth.slice(0, 7);
  const startMonth = addMonths(endMonth, -(monthsBack - 1));
  const rangeStart = `${startMonth}-01`;
  const rangeEnd = `${addMonths(endMonth, 1)}-01`;

  const rows = await findOwnDocsForRange(groupId, userId, rangeStart, rangeEnd);

  const byMonth = new Map<string, { incomeCents: number; expenseCents: number; savedCents: number; lentCents: number }>();
  for (let i = 0; i < monthsBack; i++) {
    byMonth.set(addMonths(startMonth, i), { incomeCents: 0, expenseCents: 0, savedCents: 0, lentCents: 0 });
  }
  for (const row of rows) {
    const entry = byMonth.get(row.month);
    if (!entry) continue; // outside the requested window -- can't happen given the query's own range, kept defensive
    if (row.isSecuredCardTransfer) {
      entry.savedCents += row.transactionType === "income" ? -row.amountCents : row.amountCents;
    } else if (row.isLoanTransfer) {
      entry.lentCents += row.transactionType === "income" ? -row.amountCents : row.amountCents;
    } else if (row.transactionType === "income") {
      entry.incomeCents += row.amountCents;
    } else {
      entry.expenseCents += row.amountCents;
    }
  }

  return Array.from(byMonth.entries()).map(([month, { incomeCents, expenseCents, savedCents, lentCents }]) => ({
    month,
    income: Number(fromCents(incomeCents)),
    expense: Number(fromCents(expenseCents)),
    savedInCards: Number(fromCents(savedCents)),
    lentOut: Number(fromCents(lentCents)),
    net: Number(fromCents(incomeCents - expenseCents - savedCents - lentCents)),
  }));
}

// Joint-account transactions are manageable by any group member (same rule
// as joint debts); personal-account transactions stay restricted to whoever
// created them.
function canManageTransaction(userId: string, transaction: { accountType: string; createdBy: string }): boolean {
  return transaction.accountType === "joint" || transaction.createdBy === userId;
}

export async function deleteTransactionForUser(userId: string, transactionId: string) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  if (transaction.securedCardId || transaction.loanId) {
    throw new SecuredCardTransferError(transaction.loanId ? "loan" : "card");
  }
  const linkKind = await linkKindOf(groupId, transaction);
  if (linkKind) {
    throw new LinkedTransactionError(linkKind);
  }
  await deleteTransaction(transactionId);
}

export class NotSplitError extends Error {}
export class InvalidSettlementAmountError extends Error {}

// "Marcar como pago" -- unlike a plain status flag, this actually books the
// money: creates a real income transaction for whatever the other member(s)
// paid back (a Pix, cash...) on the same account the original expense hit,
// so the Painel/saldo reflects it too, not just a "not owed anymore" label.
// Same linked-transaction pattern as debts/cards/shopping: settlementTransactionId
// on the original expense points at it, and reopening ("em aberto" again)
// deletes it -- the split status and that income entry always move together.
export async function setSplitSettledForUser(
  userId: string,
  transactionId: string,
  isSettled: boolean,
  amount?: number
) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  if (transaction.splitType === "none") {
    throw new NotSplitError();
  }

  const originalRef = transactionDocRef(transactionId);
  // Tudo numa transação do Firestore: dois cliques em "pago" (ou a rede
  // repetindo o pedido) não criam dois reembolsos.
  if (isSettled) {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new InvalidSettlementAmountError();
    }
    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(originalRef);
      if (!current.exists || current.data()!.isSettled) return;
      const settlementId = writeNewTransaction(t, {
        groupId: transaction.groupId,
        accountId: transaction.accountId,
        accountType: transaction.accountType,
        accountOwnerId: transaction.accountOwnerId,
        categoryId: null,
        payerId: userId,
        createdBy: userId,
        description: `Reembolso: ${transaction.description}`,
        amount,
        transactionType: "income",
        occurredAt: todayInBrazil(),
        isPrivate: false,
        splitType: "none",
        linkKind: "settlement",
      });
      t.update(originalRef, { isSettled: true, settlementTransactionId: settlementId, updatedAt: FieldValue.serverTimestamp() });
    });
  } else {
    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(originalRef);
      if (!current.exists || !current.data()!.isSettled) return;
      const settlementId = current.data()!.settlementTransactionId as string | null;
      const removal = settlementId ? await prepareTransactionDelete(t, settlementId) : null;
      removal?.apply();
      t.update(originalRef, { isSettled: false, settlementTransactionId: null, updatedAt: FieldValue.serverTimestamp() });
    });
  }
  return (await findTransactionById(transactionId))!;
}

// "Cancel this subscription/rent/salary" -- deletes this occurrence and
// every later one in the same recurring series, leaving past occurrences
// (already-happened months) untouched in the ledger.
export async function cancelRecurringForUser(userId: string, transactionId: string) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (
    !transaction ||
    transaction.groupId !== groupId ||
    !transaction.recurringGroupId ||
    !canManageTransaction(userId, transaction)
  ) {
    throw new TransactionNotFoundError();
  }

  const series = await findRecurringSeries(transaction.recurringGroupId);
  const idsToDelete = series
    .filter((occurrence) => occurrence.occurredAt >= transaction.occurredAt)
    .map((occurrence) => occurrence.id);
  await deleteTransactionsBatch(idsToDelete);
  return { cancelledCount: idsToDelete.length };
}

export class InvalidRecurringUpdateError extends Error {}

// "The rent went up" -- unlike a plain edit (which only ever touches the
// one occurrence you clicked), this rewrites the amount/description on
// this occurrence and every later one in the same series, leaving past
// (already-happened) occurrences exactly as they were. Same "this and
// future" scope as cancelRecurringForUser above.
export async function updateRecurringForUser(
  userId: string,
  transactionId: string,
  input: { amount?: number; description?: string }
) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (
    !transaction ||
    transaction.groupId !== groupId ||
    !transaction.recurringGroupId ||
    !canManageTransaction(userId, transaction)
  ) {
    throw new TransactionNotFoundError();
  }
  if (input.amount === undefined && input.description === undefined) {
    throw new InvalidRecurringUpdateError();
  }
  if (input.amount !== undefined && input.amount <= 0) {
    throw new InvalidRecurringUpdateError();
  }

  const series = await findRecurringSeries(transaction.recurringGroupId);
  const futureOccurrences = series.filter((occurrence) => occurrence.occurredAt >= transaction.occurredAt);

  const members = input.amount !== undefined ? await findMembersByGroupId(groupId) : [];
  await Promise.all(
    futureOccurrences.map((occurrence) =>
      // Each occurrence carries its own splits (independent docs, created
      // per-occurrence when the series was first generated) -- an amount
      // change has to resync every one of them individually, same as a
      // regular single-transaction edit does for its own splits.
      updateTransaction(
        occurrence.id,
        { amount: input.amount, description: input.description },
        input.amount !== undefined && occurrence.splitType === "equal" && occurrence.transactionType === "expense"
          ? equalSplits(input.amount, members)
          : undefined
      )
    )
  );

  return { updatedCount: futureOccurrences.length };
}

export interface UpdateTransactionInput {
  description?: string;
  amount?: number;
  transactionType?: TransactionType;
  categoryId?: string | null;
  occurredAt?: string;
  payerId?: string;
  accountId?: string;
  paymentMethod?: PaymentMethod | null;
}

export async function updateTransactionForUser(
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput
) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  if (transaction.securedCardId || transaction.loanId) {
    throw new SecuredCardTransferError(transaction.loanId ? "loan" : "card");
  }

  // Lançamento de outra tela: dá pra mudar nome, categoria e forma de
  // pagamento; valor, tipo, data, conta e quem pagou só por lá.
  const changesMoney =
    (input.amount !== undefined && toCents(input.amount) !== toCents(Number(transaction.amount))) ||
    (input.transactionType !== undefined && input.transactionType !== transaction.transactionType) ||
    (input.occurredAt !== undefined && input.occurredAt !== transaction.occurredAt) ||
    (input.payerId !== undefined && input.payerId !== transaction.payerId) ||
    (input.accountId !== undefined && input.accountId !== transaction.accountId);
  if (changesMoney) {
    const linkKind = await linkKindOf(groupId, transaction);
    if (linkKind) throw new LinkedTransactionError(linkKind);
  }

  if (input.categoryId && !(await categoryIsVisibleTo(input.categoryId, groupId))) {
    throw new InvalidCategoryError();
  }

  // Moving a transaction to a different account means the target account
  // must also belong to this group -- otherwise you could quietly move
  // money into (or a private expense onto) an account nobody here owns.
  // accountType/accountOwnerId are denormalized onto the transaction from
  // the account at write time (same as on create) and have to be
  // refreshed together whenever accountId changes.
  let accountFields: { accountId?: string; accountType?: "personal" | "joint"; accountOwnerId?: string | null } = {};
  if (input.accountId !== undefined && input.accountId !== transaction.accountId) {
    const account = await findUsableAccount(groupId, userId, input.accountId);
    if (!account) {
      throw new InvalidAccountError();
    }
    accountFields = { accountId: account.id, accountType: account.type, accountOwnerId: account.ownerUserId };
  }

  if (input.payerId !== undefined && input.payerId !== transaction.payerId) {
    const members = await findMembersByGroupId(groupId);
    if (!members.some((member) => member.id === input.payerId)) {
      throw new InvalidPayerError();
    }
  }

  // Keep "who owes whom" consistent with the edited amount/type: income has
  // no debt, and an equal-split expense's shares must track the new amount
  // (or appear, when an income becomes an expense). Vai no mesmo lote da edição.
  const nextType = input.transactionType ?? transaction.transactionType;
  let splits: SplitInput[] | undefined;
  if (nextType === "income") {
    if (transaction.splitType !== "none") splits = [];
  } else if (
    transaction.splitType === "equal" &&
    (input.amount !== undefined || transaction.transactionType === "income")
  ) {
    splits = equalSplits(input.amount ?? Number(transaction.amount), await findMembersByGroupId(groupId));
  }

  const updated = await updateTransaction(
    transactionId,
    {
      description: input.description,
      amount: input.amount,
      transactionType: input.transactionType,
      categoryId: input.categoryId,
      occurredAt: input.occurredAt,
      payerId: input.payerId,
      paymentMethod: input.paymentMethod,
      ...accountFields,
    },
    splits
  );

  return updated;
}
