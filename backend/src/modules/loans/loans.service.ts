import { randomUUID } from "node:crypto";
import { findAccountsByGroupId, type AccountRow } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { deleteTransactionsBatch, insertTransaction } from "../transactions/transactions.repository";
import { fromCents, toCents } from "../../utils/money";
import {
  deleteLoan,
  findLoanById,
  findLoansByGroupId,
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

// Empréstimos ("a receber"): dinheiro que você emprestou pra família e
// amigos. Emprestar de uma conta lança uma transferência (loanId) que tira o
// dinheiro do saldo sem contar como gasto; cada "Recebi" lança a volta.
// Empréstimos são pessoais -- só quem emprestou vê, mesmo num grupo
// compartilhado. A exceção é o que saiu da Nossa Conta: o dinheiro era dos
// dois, então os dois veem (só quem emprestou mexe).

export interface LoanWithTotals extends LoanRow {
  received: string;
  // Juros acumulados até agora (0.00 quando não tem taxa) e o valor
  // emprestado + juros.
  interest: string;
  totalOwed: string;
  remaining: string;
  // Quanto vai faltar no dia do prazo, com os juros que ainda vão correr até
  // lá. Só vem quando tem juros e o prazo ainda não chegou.
  remainingAtDue: string | null;
  isOverdue: boolean;
  // false = empréstimo da outra pessoa que saiu da Nossa Conta (só leitura).
  isMine: boolean;
}

export interface LoansSummary {
  // Tudo que ainda te devem (só empréstimos em aberto).
  outstanding: string;
  overdue: string;
  overdueCount: number;
  // Devido com prazo nos próximos 30 dias (ainda não atrasado).
  dueSoon: string;
  // Devido sem prazo nenhum.
  noDueDate: string;
  openCount: number;
}

// "Hoje" no Brasil -- um prazo fica atrasado a partir do dia seguinte, no
// horário local.
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

// Meses cheios de `from` até `to` (um mês conta quando o dia dele chega).
export function fullMonthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const months = (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
  return Math.max(0, months);
}

// Juros simples sobre o valor emprestado, por mês cheio. Para de contar no
// dia em que o empréstimo foi quitado.
export function interestCents(loan: LoanRow, today: string): number {
  if (!loan.interestRateMonthly) return 0;
  const lastRepayment = loan.repayments.map((r) => r.receivedAt).sort().at(-1);
  const until = loan.status === "paid" && lastRepayment ? lastRepayment : today;
  return interestUntilCents(loan, until);
}

function interestUntilCents(loan: LoanRow, until: string): number {
  if (!loan.interestRateMonthly) return 0;
  const months = fullMonthsBetween(loan.lentAt, until);
  return Math.round(toCents(Number(loan.amount)) * (loan.interestRateMonthly / 100) * months);
}

function totalOwedCents(loan: LoanRow, today: string): number {
  return toCents(Number(loan.amount)) + interestCents(loan, today);
}

function remainingCents(loan: LoanRow, today = todayInBrazil()): number {
  return Math.max(0, totalOwedCents(loan, today) - receivedCents(loan));
}

function remainingAtDueCents(loan: LoanRow, today: string): number | null {
  if (loan.status !== "open" || !loan.interestRateMonthly || !loan.dueDate || loan.dueDate <= today) return null;
  const owedAtDue = toCents(Number(loan.amount)) + interestUntilCents(loan, loan.dueDate);
  return Math.max(0, owedAtDue - receivedCents(loan));
}

function withTotals(loan: LoanRow, today: string, viewerId: string = loan.ownerUserId): LoanWithTotals {
  const remaining = remainingCents(loan, today);
  const atDue = remainingAtDueCents(loan, today);
  return {
    ...loan,
    received: fromCents(receivedCents(loan)),
    interest: fromCents(interestCents(loan, today)),
    totalOwed: fromCents(totalOwedCents(loan, today)),
    remaining: fromCents(remaining),
    remainingAtDue: atDue === null ? null : fromCents(atDue),
    isOverdue: loan.status === "open" && remaining > 0 && loan.dueDate !== null && loan.dueDate < today,
    isMine: loan.ownerUserId === viewerId,
  };
}

// Em aberto primeiro (atrasados, depois por prazo, sem prazo por último),
// resolvidos depois.
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
  const [rows, accounts] = await Promise.all([findLoansByGroupId(groupId), findAccountsByGroupId(groupId)]);
  const jointIds = new Set(accounts.filter((a) => a.type === "joint").map((a) => a.id));
  const loans = rows
    .filter((loan) => loan.ownerUserId === userId || (loan.accountId !== null && jointIds.has(loan.accountId)))
    .map((loan) => withTotals(loan, today, userId))
    .sort(compareLoans);
  return { loans, summary: summarize(loans, today) };
}

// Todos os empréstimos de um grupo, com os totais -- pro job diário de
// lembretes, que não tem usuário logado.
export async function findLoansByGroup(groupId: string): Promise<LoanWithTotals[]> {
  const today = todayInBrazil();
  return (await findLoansByGroupId(groupId)).map((loan) => withTotals(loan, today));
}

// Conta pessoal de quem emprestou ou a Nossa Conta -- nunca a de outra
// pessoa.
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
  interestRateMonthly?: number | null;
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
    interestRateMonthly: input.interestRateMonthly ?? null,
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
  // "forgiven" = desistiu de receber o resto; "open" reabre.
  status?: "open" | "forgiven";
  interestRateMonthly?: number | null;
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
    ...(input.interestRateMonthly !== undefined ? { interestRateMonthly: input.interestRateMonthly } : {}),
    ...(status ? { status } : {}),
  });
  return withTotals(updated, todayInBrazil());
}

// Excluir desfaz tudo que foi lançado -- o saldo volta a ser como era antes
// do empréstimo ser registrado.
export async function removeLoan(userId: string, loanId: string): Promise<void> {
  const { loan } = await requireOwnLoan(userId, loanId);
  const transactionIds = [loan.transactionId, ...loan.repayments.map((r) => r.transactionId)].filter(
    (id): id is string => id !== null
  );
  await deleteTransactionsBatch(transactionIds);
  await deleteLoan(loan.id);
}
