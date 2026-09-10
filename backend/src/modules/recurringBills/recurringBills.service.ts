import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  createTransaction,
  InvalidAccountError,
  InvalidCategoryError,
  InvalidPayerError,
  UnsupportedSplitTypeError,
} from "../transactions/transactions.service";
import type { SplitType, TransactionType } from "../transactions/transactions.repository";
import { dateForDayInMonth } from "../../utils/month";
import {
  deleteRecurringBill,
  findAllActiveRecurringBills,
  findRecurringBillById,
  findRecurringBillsByGroupId,
  insertRecurringBill,
  markRecurringBillGenerated,
  updateRecurringBill,
  type RecurringBillRow,
} from "./recurringBills.repository";

export class RecurringBillNotFoundError extends Error {}
export class InvalidDayOfMonthError extends Error {}

const SUPPORTED_SPLIT_TYPES: SplitType[] = ["none", "equal"];

function isValidDayOfMonth(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

export interface CreateRecurringBillInput {
  accountId: string;
  categoryId: string | null;
  payerId: string;
  description: string;
  amount: number;
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

  const [accounts, members] = await Promise.all([findAccountsByGroupId(groupId), findMembersByGroupId(groupId)]);
  const account = accounts.find((a) => a.id === input.accountId);
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

  return insertRecurringBill({
    groupId,
    accountId: account.id,
    accountType: account.type,
    accountOwnerId: account.ownerUserId,
    createdBy: userId,
    payerId: input.payerId,
    categoryId: input.categoryId,
    description: input.description.trim(),
    amount: input.amount,
    transactionType: input.transactionType,
    isPrivate: input.isPrivate,
    splitType: input.splitType,
    dayOfMonth: input.dayOfMonth,
  });
}

// Same visibility rule as transactions/debts: a joint-account bill is
// everyone's business, a personal-account one only its own owner's.
function isVisibleTo(userId: string, bill: RecurringBillRow): boolean {
  return bill.accountType === "joint" || bill.accountOwnerId === userId;
}

export async function listRecurringBillsForUser(userId: string): Promise<RecurringBillRow[]> {
  const groupId = await requireGroupId(userId);
  const bills = await findRecurringBillsByGroupId(groupId);
  return bills.filter((bill) => isVisibleTo(userId, bill));
}

async function requireManageableBill(userId: string, billId: string): Promise<RecurringBillRow> {
  const groupId = await requireGroupId(userId);
  const bill = await findRecurringBillById(billId);
  if (!bill || bill.groupId !== groupId || !isVisibleTo(userId, bill)) {
    throw new RecurringBillNotFoundError();
  }
  return bill;
}

export interface UpdateRecurringBillInput {
  description?: string;
  amount?: number;
  dayOfMonth?: number;
  categoryId?: string | null;
  isActive?: boolean;
}

export async function updateRecurringBillForUser(userId: string, billId: string, input: UpdateRecurringBillInput) {
  await requireManageableBill(userId, billId);

  if (input.dayOfMonth !== undefined && !isValidDayOfMonth(input.dayOfMonth)) {
    throw new InvalidDayOfMonthError();
  }
  if (input.amount !== undefined && input.amount <= 0) {
    throw new InvalidDayOfMonthError();
  }

  return updateRecurringBill(billId, input);
}

export async function deleteRecurringBillForUser(userId: string, billId: string): Promise<void> {
  await requireManageableBill(userId, billId);
  await deleteRecurringBill(billId);
}

// Entry point for the daily cron (folded into POST /api/reminders/run --
// same "no per-request user" shape as runDueReminders, no new cron/secret
// to set up). For every active bill whose day has arrived and that hasn't
// already generated a transaction this calendar month, creates the real
// transaction through createTransaction -- the exact same path a manual
// lancamento takes, so it gets the same validation, splits and denormalized
// account fields for free.
export async function generateDueRecurringBills(): Promise<{ billsChecked: number; transactionsCreated: number }> {
  const bills = await findAllActiveRecurringBills();
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const currentDay = now.getUTCDate();
  let transactionsCreated = 0;

  for (const bill of bills) {
    if (bill.lastGeneratedMonth === currentMonth) continue;

    const dueDate = dateForDayInMonth(currentMonth, bill.dayOfMonth);
    const dueDay = Number(dueDate.slice(8, 10));
    if (currentDay < dueDay) continue;

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
