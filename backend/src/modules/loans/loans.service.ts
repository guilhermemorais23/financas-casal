import { randomUUID } from "node:crypto";
import { findAccountsByGroupId, type AccountRow } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransactionsBatch, insertTransaction } from "../transactions/transactions.repository";
import { fromCents, toCents } from "../../utils/money";
import {
  deleteLoan,
  findLoanById,
  findLoansByOwner,
  insertLoan,
  newLoanId,
  updateLoan,
  type LoanRow,
  type LoanStatus,
} from "./loans.repository";

export class LoanNotFoundError extends Error {}
export class InvalidLoanAccountError extends Error {}
export class RepaymentTooLargeError extends Error {}
export class RepaymentNotFoundError extends Error {}

// Empréstimos ("a receber"): money you lent to family/friends. Lending from
// an account books a transfer (loanId) that takes the money out of the
// balance without counting as a gasto; each "Recebi" books the way back in.
// Loans are personal -- only whoever lent sees them, even in a shared group.

export interface LoanWithTotals extends LoanRow {
  received: string;
  remaining: string;
  isOverdue: boolean;
}

export interface LoansSummary {
  // Everything still owed to you (open loans only).
  outstanding: string;
  overdue: string;
  overdueCount: number;
  // Owed with a deadline in the next 30 days (not overdue yet).
  dueSoon: string;
  // Owed with no deadline at all.
  noDueDate: string;
  openCount: number;
}

// "Today" in Brazil -- a due date is overdue from the day after it, local time.
export function todayInBrazil(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function receivedCents(loan: LoanRow): number {
  return loan.repayments.reduce((sum, r) => sum + toCents(Number(r.amount)), 0);
}

function remainingCents(loan: LoanRow): number {
  return Math.max(0, toCents(Number(loan.amount)) - receivedCents(loan));
}

function withTotals(loan: LoanRow, today: string): LoanWithTotals {
  const remaining = remainingCents(loan);
  return {
    ...loan,
    received: fromCents(receivedCents(loan)),
    remaining: fromCents(remaining),
    isOverdue: loan.status === "open" && remaining > 0 && loan.dueDate !== null && loan.dueDate < today,
  };
}

// Open first (overdue, then by deadline, no deadline last), finished after.
function compareLoans(a: LoanWithTotals, b: LoanWithTotals): number {
  const aOpen = a.status === "open" ? 0 : 1;
  const bOpen = b.status === "open" ? 0 : 1;
  if (aOpen !== bOpen) return aOpen - bOpen;
  const aDue = a.dueDate ?? "9999-12-31";
  const bDue = b.dueDate ?? "9999-12-31";
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return a.lentAt < b.lentAt ? 1 : -1;
}

export function summarize(loans: LoanWithTotals[], today: string): LoansSummary {
  const soonLimit = addDays(today, 30);
  let outstanding = 0;
  let overdue = 0;
  let overdueCount = 0;
  let dueSoon = 0;
  let noDueDate = 0;
  let openCount = 0;
  for (const loan of loans) {
    if (loan.status !== "open") continue;
    const remaining = toCents(Number(loan.remaining));
    if (remaining === 0) continue;
    openCount += 1;
    outstanding += remaining;
    if (loan.isOverdue) {
      overdue += remaining;
      overdueCount += 1;
    } else if (loan.dueDate === null) {
      noDueDate += remaining;
    } else if (loan.dueDate <= soonLimit) {
      dueSoon += remaining;
    }
  }
  return {
    outstanding: fromCents(outstanding),
    overdue: fromCents(overdue),
    overdueCount,
    dueSoon: fromCents(dueSoon),
    noDueDate: fromCents(noDueDate),
    openCount,
  };
}

export async function listLoans(userId: string): Promise<{ loans: LoanWithTotals[]; summary: LoansSummary }> {
  const groupId = await requireGroupId(userId);
  const today = todayInBrazil();
  const loans = (await findLoansByOwner(groupId, userId)).map((loan) => withTotals(loan, today)).sort(compareLoans);
  return { loans, summary: summarize(loans, today) };
}

// Personal account of the lender or Nossa Conta -- never someone else's.
async function resolveAccount(groupId: string, userId: string, accountId: string | null): Promise<AccountRow | null> {
  if (accountId === null) return null;
  const accounts = await findAccountsByGroupId(groupId);
  const account = accounts.find((a) => a.id === accountId);
  if (!account || (account.type === "personal" && account.ownerUserId !== userId)) {
    throw new InvalidLoanAccountError();
  }
  return account;
}

async function bookTransfer(
  userId: string,
  groupId: string,
  account: AccountRow,
  loanId: string,
  direction: "lend" | "receive",
  personName: string,
  amount: number,
  occurredAt: string
): Promise<string> {
  const row = await insertTransaction({
    groupId,
    accountId: account.id,
    accountType: account.type,
    accountOwnerId: account.ownerUserId,
    categoryId: null,
    payerId: userId,
    createdBy: userId,
    description: direction === "lend" ? `Emprestado para ${personName}` : `Recebido de ${personName}`,
    amount,
    transactionType: direction === "lend" ? "expense" : "income",
    occurredAt,
    isPrivate: false,
    splitType: "none",
    loanId,
  });
  return row.id;
}

async function requireOwnLoan(userId: string, loanId: string) {
  const groupId = await requireGroupId(userId);
  const loan = await findLoanById(loanId);
  if (!loan || loan.groupId !== groupId || loan.ownerUserId !== userId) {
    throw new LoanNotFoundError();
  }
  return { groupId, loan };
}

export interface CreateLoanInput {
  personName: string;
  amount: number;
  lentAt: string;
  dueDate: string | null;
  note: string | null;
  accountId: string | null;
}

export async function createLoan(userId: string, input: CreateLoanInput): Promise<LoanWithTotals> {
  const groupId = await requireGroupId(userId);
  const account = await resolveAccount(groupId, userId, input.accountId);
  const id = newLoanId();
  const transactionId = account
    ? await bookTransfer(userId, groupId, account, id, "lend", input.personName, input.amount, input.lentAt)
    : null;
  const loan = await insertLoan(id, {
    groupId,
    ownerUserId: userId,
    personName: input.personName,
    amount: input.amount,
    lentAt: input.lentAt,
    dueDate: input.dueDate,
    note: input.note,
    accountId: account?.id ?? null,
    transactionId,
  });
  return withTotals(loan, todayInBrazil());
}

export interface RepaymentInput {
  amount: number;
  receivedAt: string;
  accountId: string | null;
}

export async function addRepayment(userId: string, loanId: string, input: RepaymentInput): Promise<LoanWithTotals> {
  const { groupId, loan } = await requireOwnLoan(userId, loanId);
  const remaining = remainingCents(loan);
  if (toCents(input.amount) > remaining) {
    throw new RepaymentTooLargeError(fromCents(remaining));
  }
  const account = await resolveAccount(groupId, userId, input.accountId);
  const transactionId = account
    ? await bookTransfer(userId, groupId, account, loan.id, "receive", loan.personName, input.amount, input.receivedAt)
    : null;
  const repayments = [
    ...loan.repayments,
    {
      id: randomUUID(),
      amount: input.amount.toFixed(2),
      receivedAt: input.receivedAt,
      accountId: account?.id ?? null,
      transactionId,
    },
  ];
  const fullyPaid = toCents(input.amount) === remaining;
  const updated = await updateLoan(loan.id, { repayments, ...(fullyPaid ? { status: "paid" as LoanStatus } : {}) });
  return withTotals(updated, todayInBrazil());
}

export async function removeRepayment(userId: string, loanId: string, repaymentId: string): Promise<LoanWithTotals> {
  const { loan } = await requireOwnLoan(userId, loanId);
  const repayment = loan.repayments.find((r) => r.id === repaymentId);
  if (!repayment) throw new RepaymentNotFoundError();
  if (repayment.transactionId) await deleteTransactionsBatch([repayment.transactionId]);
  const updated = await updateLoan(loan.id, {
    repayments: loan.repayments.filter((r) => r.id !== repaymentId),
    ...(loan.status === "paid" ? { status: "open" as LoanStatus } : {}),
  });
  return withTotals(updated, todayInBrazil());
}

export interface UpdateLoanInput {
  personName?: string;
  dueDate?: string | null;
  note?: string | null;
  // "forgiven" = gave up on receiving the rest; "open" reopens it.
  status?: "open" | "forgiven";
}

export async function updateLoanForUser(userId: string, loanId: string, input: UpdateLoanInput): Promise<LoanWithTotals> {
  const { loan } = await requireOwnLoan(userId, loanId);
  let status: LoanStatus | undefined;
  if (input.status === "forgiven") status = "forgiven";
  if (input.status === "open") status = remainingCents(loan) === 0 ? "paid" : "open";
  const updated = await updateLoan(loan.id, {
    ...(input.personName !== undefined ? { personName: input.personName } : {}),
    ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(status ? { status } : {}),
  });
  return withTotals(updated, todayInBrazil());
}

// Deleting undoes everything it booked -- the balance goes back to how it
// was before the loan was registered.
export async function removeLoan(userId: string, loanId: string): Promise<void> {
  const { loan } = await requireOwnLoan(userId, loanId);
  const transactionIds = [loan.transactionId, ...loan.repayments.map((r) => r.transactionId)].filter(
    (id): id is string => id !== null
  );
  await deleteTransactionsBatch(transactionIds);
  await deleteLoan(loan.id);
}
