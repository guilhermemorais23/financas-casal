import { FieldValue } from "firebase-admin/firestore";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findMembersByGroupId, findUsableAccount } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  createTransaction,
  InvalidAccountError,
  InvalidCategoryError,
  InvalidPayerError,
  UnsupportedSplitTypeError,
} from "../transactions/transactions.service";
import {
  findOwnDocsForRange,
  runLedgerTransaction,
  writeNewTransaction,
  type SplitType,
  type TransactionType,
} from "../transactions/transactions.repository";
import { fromCents, splitEvenly, toCents } from "../../utils/money";
import { addMonths, dateForDayInMonth, daysBetween, todayInBrazil } from "../../utils/month";
import {
  AMOUNT_MODES,
  DEFAULT_REMIND_DAYS,
  REMIND_DAYS,
  deleteRecurringBill,
  findAllActiveRecurringBills,
  findRecurringBillById,
  findRecurringBillsByGroupId,
  insertRecurringBill,
  markRecurringBillGenerated,
  recurringBillRef,
  setRecurringBillSnooze,
  toRecurringBillRow,
  updateRecurringBill,
  type AmountMode,
  type RecurringBillRow,
} from "./recurringBills.repository";

export class RecurringBillNotFoundError extends Error {}
export class InvalidDayOfMonthError extends Error {}
// Valor que não combina com o modo (conta de valor certo sem valor...).
export class InvalidBillAmountError extends Error {}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

export function isValidDayOfMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export function isAmountMode(value: unknown): value is AmountMode {
  return AMOUNT_MODES.includes(value as AmountMode);
}

export function isRemindDays(value: unknown): value is number {
  return REMIND_DAYS.includes(value as (typeof REMIND_DAYS)[number]);
}

// Valor certo e estimativa precisam de valor; "não sei ainda" não guarda valor.
function amountForMode(mode: AmountMode, amount: number | null | undefined): number | null {
  if (mode === "unknown") return null;
  if (typeof amount !== "number" || !(amount > 0)) throw new InvalidBillAmountError();
  return amount;
}

// Primeiro mês com algo a pagar: se o dia deste mês já passou quando a conta
// foi criada, começa no mês que vem.
function firstMonthFrom(today: string, dayOfMonth: number): string {
  const thisMonth = today.slice(0, 7);
  return dateForDayInMonth(thisMonth, dayOfMonth) >= today ? thisMonth : addMonths(thisMonth, 1);
}

export interface CreateRecurringBillInput {
  accountId: string;
  categoryId: string | null;
  payerId: string;
  description: string;
  amount: number | null;
  amountMode?: AmountMode;
  remindDaysBefore?: number;
  transactionType: TransactionType;
  isPrivate: boolean;
  splitType: SplitType;
  dayOfMonth: number;
}

export async function createRecurringBillForUser(userId: string, input: CreateRecurringBillInput) {
  const groupId = await requireGroupId(userId);

  if (!isValidDayOfMonth(input.dayOfMonth)) {
    throw new InvalidDayOfMonthError();
  }
  const amountMode = input.amountMode ?? "fixed";
  const amount = amountForMode(amountMode, input.amount);

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

  return withExpected(
    await insertRecurringBill({
      groupId,
      accountId: account.id,
      accountType: account.type,
      accountOwnerId: account.ownerUserId,
      createdBy: userId,
      payerId: input.payerId,
      categoryId: input.categoryId,
      description: input.description.trim(),
      amount,
      amountMode,
      remindDaysBefore: input.remindDaysBefore ?? DEFAULT_REMIND_DAYS,
      startMonth: amountMode === "fixed" ? null : firstMonthFrom(todayInBrazil(), input.dayOfMonth),
      transactionType: input.transactionType,
      isPrivate: input.isPrivate,
      splitType: input.splitType,
      dayOfMonth: input.dayOfMonth,
    })
  );
}

// Same visibility rule as transactions/debts: a joint-account bill is
// everyone's business, a personal-account one only its own owner's.
function isVisibleTo(userId: string, bill: RecurringBillRow): boolean {
  return bill.accountType === "joint" || bill.accountOwnerId === userId;
}

// ---------------------------------------------------------------------------
// Valor esperado e mês pendente
// ---------------------------------------------------------------------------

// Quanto deve vir: o valor certo; na estimativa, a média dos últimos 3
// valores reais (depois de 3 meses) ou o chute de quem cadastrou; sem valor,
// null.
export function expectedAmount(bill: RecurringBillRow): number | null {
  if (bill.amountMode === "fixed") return bill.amount === null ? null : Number(bill.amount);
  if (bill.amountMode === "estimate") {
    const recent = bill.recentAmountsCents.slice(-3);
    if (recent.length >= 3) return Number(fromCents(Math.round(recent.reduce((sum, c) => sum + c, 0) / recent.length)));
    return bill.amount === null ? null : Number(bill.amount);
  }
  return null;
}

export function lastPaidAmount(bill: RecurringBillRow): number | null {
  const last = bill.recentAmountsCents[bill.recentAmountsCents.length - 1];
  return typeof last === "number" ? Number(fromCents(last)) : null;
}

export interface RecurringBillWithExpected extends RecurringBillRow {
  expectedAmount: number | null;
  lastPaidAmount: number | null;
}

function withExpected(bill: RecurringBillRow): RecurringBillWithExpected {
  return { ...bill, expectedAmount: expectedAmount(bill), lastPaidAmount: lastPaidAmount(bill) };
}

// Mês da próxima conta a pagar. Valor certo: lança sozinha, então é este mês
// até o dia chegar e o mês que vem depois. Sem valor certo: o mês seguinte ao
// último confirmado -- uma conta que ninguém confirmou continua pendente
// (atrasada) em vez de sumir quando o mês vira.
export function pendingMonthFor(bill: RecurringBillRow, today: string): string {
  const thisMonth = today.slice(0, 7);
  if (bill.amountMode === "fixed") {
    return bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
  }
  if (bill.lastGeneratedMonth) return addMonths(bill.lastGeneratedMonth, 1);
  return bill.startMonth ?? firstMonthFrom(today, bill.dayOfMonth);
}

// "Quando o salário cair": volta a avisar quando entra uma receita de pelo
// menos R$ 300 na conta pessoal de quem adiou, ou depois de 15 dias.
const SALARY_MIN_CENTS = 30_000;
const SALARY_MAX_WAIT_DAYS = 15;

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function salaryArrived(groupId: string, userId: string, since: string, today: string): Promise<boolean> {
  if (daysBetween(since, today) >= SALARY_MAX_WAIT_DAYS) return true;
  const docs = await findOwnDocsForRange(groupId, userId, since, addDaysIso(today, 1));
  return docs.some(
    (doc) => doc.transactionType === "income" && !doc.isSecuredCardTransfer && !doc.isLoanTransfer && doc.amountCents >= SALARY_MIN_CENTS
  );
}

// O "Me lembre mais tarde" ainda está valendo pra esse mês?
export async function isSnoozed(bill: RecurringBillRow, month: string, today: string): Promise<boolean> {
  if (bill.snoozedMonth !== month) return false;
  if (bill.snoozedUntil) return today < bill.snoozedUntil;
  if (bill.snoozeSalarySince && bill.snoozedBy) {
    return !(await salaryArrived(bill.groupId, bill.snoozedBy, bill.snoozeSalarySince, today));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Lista, edição, exclusão
// ---------------------------------------------------------------------------

export async function listRecurringBillsForUser(userId: string): Promise<RecurringBillWithExpected[]> {
  const groupId = await requireGroupId(userId);
  const bills = await findRecurringBillsByGroupId(groupId);
  return bills.filter((bill) => isVisibleTo(userId, bill)).map(withExpected);
}

async function requireManageableBill(userId: string, billId: string): Promise<{ groupId: string; bill: RecurringBillRow }> {
  const groupId = await requireGroupId(userId);
  const bill = await findRecurringBillById(billId);
  if (!bill || bill.groupId !== groupId || !isVisibleTo(userId, bill)) {
    throw new RecurringBillNotFoundError();
  }
  return { groupId, bill };
}

export interface UpdateRecurringBillInput {
  description?: string;
  amount?: number | null;
  amountMode?: AmountMode;
  remindDaysBefore?: number;
  dayOfMonth?: number;
  categoryId?: string | null;
  isActive?: boolean;
}

export async function updateRecurringBillForUser(userId: string, billId: string, input: UpdateRecurringBillInput) {
  const { bill } = await requireManageableBill(userId, billId);

  if (input.dayOfMonth !== undefined && !isValidDayOfMonth(input.dayOfMonth)) {
    throw new InvalidDayOfMonthError();
  }

  const fields: Parameters<typeof updateRecurringBill>[1] = {
    description: input.description,
    dayOfMonth: input.dayOfMonth,
    categoryId: input.categoryId,
    isActive: input.isActive,
    remindDaysBefore: input.remindDaysBefore,
  };
  const nextMode = input.amountMode ?? bill.amountMode;
  if (input.amountMode !== undefined || input.amount !== undefined) {
    const nextAmount = input.amount !== undefined ? input.amount : bill.amount === null ? null : Number(bill.amount);
    fields.amount = amountForMode(nextMode, nextAmount);
    fields.amountMode = nextMode;
  }
  // Saindo do "lança sozinha": a conta passa a esperar confirmação a partir
  // do próximo mês que ainda não foi lançado.
  if (bill.amountMode === "fixed" && nextMode !== "fixed") {
    fields.startMonth = pendingMonthFor(bill, todayInBrazil());
  }

  return withExpected(await updateRecurringBill(billId, fields));
}

export async function deleteRecurringBillForUser(userId: string, billId: string): Promise<void> {
  await requireManageableBill(userId, billId);
  await deleteRecurringBill(billId);
}

// ---------------------------------------------------------------------------
// Avisos: "Conta do celular vence em 3 dias"
// ---------------------------------------------------------------------------

export interface BillReminder {
  billId: string;
  title: string;
  month: string;
  dueDate: string;
  daysUntil: number;
  amountMode: AmountMode;
  expectedAmount: number | null;
  lastPaidAmount: number | null;
  accountId: string;
  accountType: "personal" | "joint";
  snoozed: boolean;
}

// Contas sem valor certo que estão pedindo atenção: dentro da janela de
// aviso ou atrasadas. `includeAll`: a lista "Contas do mês" -- tudo que vence
// até o fim deste mês (ou atrasado), mesmo adiado ou fora da janela.
export async function listBillRemindersForUser(userId: string, options: { includeAll?: boolean } = {}): Promise<BillReminder[]> {
  const groupId = await requireGroupId(userId);
  const today = todayInBrazil();
  const thisMonth = today.slice(0, 7);
  const bills = (await findRecurringBillsByGroupId(groupId)).filter(
    (bill) => isVisibleTo(userId, bill) && bill.isActive && bill.transactionType === "expense" && bill.amountMode !== "fixed"
  );

  const reminders: BillReminder[] = [];
  for (const bill of bills) {
    const month = pendingMonthFor(bill, today);
    const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
    const daysUntil = daysBetween(today, dueDate);
    const snoozed = await isSnoozed(bill, month, today);
    const show = options.includeAll ? month <= thisMonth : daysUntil <= bill.remindDaysBefore && !snoozed;
    if (!show) continue;
    reminders.push({
      billId: bill.id,
      title: bill.description,
      month,
      dueDate,
      daysUntil,
      amountMode: bill.amountMode,
      expectedAmount: expectedAmount(bill),
      lastPaidAmount: lastPaidAmount(bill),
      accountId: bill.accountId,
      accountType: bill.accountType,
      snoozed,
    });
  }
  return reminders.sort((a, b) => (a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1));
}

export class BillAlreadyPaidError extends Error {}

export interface PayBillInput {
  month: string;
  // Valor real. Obrigatório, a não ser com markOnly.
  amount?: number;
  // "Já lancei no extrato" (ou não teve conta esse mês): só marca o mês.
  markOnly?: boolean;
  occurredAt?: string;
}

// "Já paguei": lança o gasto com o valor real e marca o mês como resolvido,
// numa transação do Firestore que relê a conta -- dois toques (ou o mesmo
// mês confirmado no Painel e na tela Contas) não lançam duas vezes.
export async function payBillForUser(userId: string, billId: string, input: PayBillInput): Promise<RecurringBillWithExpected> {
  const { groupId, bill } = await requireManageableBill(userId, billId);
  if (bill.amountMode === "fixed") throw new InvalidBillAmountError();
  if (!input.markOnly && !(typeof input.amount === "number" && input.amount > 0)) throw new InvalidBillAmountError();

  const today = todayInBrazil();
  const members = bill.splitType === "equal" && !input.markOnly ? await findMembersByGroupId(groupId) : [];
  const ref = recurringBillRef(billId);

  const applied = await runLedgerTransaction(groupId, async (t) => {
    const current = toRecurringBillRow(await t.get(ref));
    if (pendingMonthFor(current, today) !== input.month) return false;

    const update: Record<string, unknown> = {
      lastGeneratedMonth: input.month,
      snoozedMonth: null,
      snoozedUntil: null,
      snoozeSalarySince: null,
      snoozedBy: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!input.markOnly && typeof input.amount === "number") {
      const shares = members.length > 1 ? splitEvenly(input.amount, members.length) : null;
      writeNewTransaction(
        t,
        {
          groupId,
          accountId: current.accountId,
          accountType: current.accountType,
          accountOwnerId: current.accountOwnerId,
          categoryId: current.categoryId,
          payerId: current.payerId,
          createdBy: userId,
          description: current.description,
          amount: input.amount,
          transactionType: current.transactionType,
          occurredAt: input.occurredAt ?? today,
          isPrivate: current.isPrivate,
          splitType: shares ? "equal" : "none",
        },
        shares ? members.map((member, index) => ({ userId: member.id, shareAmountCents: shares[index] })) : []
      );
      update.recentAmountsCents = [...current.recentAmountsCents, toCents(input.amount)].slice(-3);
    }
    t.update(ref, update);
    return true;
  });
  if (!applied) throw new BillAlreadyPaidError();
  return withExpected((await findRecurringBillById(billId))!);
}

export type SnoozeChoice = "tomorrow" | "due" | "salary";

// "Me lembre mais tarde" (só pro mês pendente; o mês seguinte avisa normal).
export async function snoozeBillForUser(userId: string, billId: string, choice: SnoozeChoice): Promise<{ until: string | null; salary: boolean }> {
  const { bill } = await requireManageableBill(userId, billId);
  const today = todayInBrazil();
  const month = pendingMonthFor(bill, today);
  const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
  if (choice === "salary") {
    await setRecurringBillSnooze(billId, { month, until: null, salarySince: today, by: userId });
    return { until: null, salary: true };
  }
  const until = choice === "due" && dueDate > today ? dueDate : addDaysIso(today, 1);
  await setRecurringBillSnooze(billId, { month, until, salarySince: null, by: userId });
  return { until, salary: false };
}

// ---------------------------------------------------------------------------
// Job diário
// ---------------------------------------------------------------------------

// Entry point for the daily cron (folded into POST /api/reminders/run --
// same "no per-request user" shape as runDueReminders, no new cron/secret
// to set up). For every active bill whose day has arrived and that hasn't
// already generated a transaction this calendar month, creates the real
// transaction through createTransaction -- the exact same path a manual
// lancamento takes, so it gets the same validation, splits and denormalized
// account fields for free. Só as de valor certo: as outras esperam a pessoa
// confirmar quanto foi.
export async function generateDueRecurringBills(): Promise<{ billsChecked: number; transactionsCreated: number }> {
  const bills = (await findAllActiveRecurringBills()).filter((bill) => bill.amountMode === "fixed" && bill.amount !== null);
  const today = todayInBrazil();
  const currentMonth = today.slice(0, 7);
  let transactionsCreated = 0;

  for (const bill of bills) {
    if (bill.lastGeneratedMonth === currentMonth) continue;

    const dueDate = dateForDayInMonth(currentMonth, bill.dayOfMonth);
    if (today < dueDate) continue;

    try {
      await createTransaction(bill.createdBy, {
        accountId: bill.accountId,
        categoryId: bill.categoryId,
        payerId: bill.payerId,
        description: bill.description,
        amount: Number(bill.amount),
        transactionType: bill.transactionType,
        occurredAt: dueDate,
        isPrivate: bill.isPrivate,
        splitType: bill.splitType,
      });
      transactionsCreated++;
    } catch (err) {
      // A bill whose account/payer/category no longer exists (member left
      // the group, category got deleted) shouldn't crash the whole cron run
      // for every other bill -- log and move on, same best-effort posture
      // as the reminders job. Still stamps lastGeneratedMonth below so a
      // permanently-broken bill doesn't retry (and fail) every single day.
      console.error(`generateDueRecurringBills: failed for bill ${bill.id}`, err);
    }

    await markRecurringBillGenerated(bill.id, currentMonth);
  }

  return { billsChecked: bills.length, transactionsCreated };
}
