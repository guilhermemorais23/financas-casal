import { FieldValue } from "firebase-admin/firestore";
import { findUsableAccount } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  deleteTransactionsBatch,
  findGoalTransferIds,
  prepareTransactionDelete,
  runLedgerTransaction,
  transactionDocRef,
  writeNewTransaction,
} from "../transactions/transactions.repository";
import { InvalidAccountError } from "../transactions/transactions.service";
import { toCents } from "../../utils/money";
import { todayInBrazil } from "../../utils/month";
import {
  MAX_GOAL_ITEMS,
  contributionDocRef,
  contributionRef,
  deleteGoal,
  findContributions,
  findGoalById,
  findGoalsByGroupId,
  goalRef,
  goalTotals,
  insertGoal,
  newGoalItem,
  storedItems,
  type GoalRow,
  type StoredGoalItem,
} from "./goals.repository";

export class GoalNotFoundError extends Error {}
export class InvalidContributionError extends Error {}
export class GoalItemNotFoundError extends Error {}
export class TooManyGoalItemsError extends Error {}
// Retirar mais do que está guardado (na meta ou na submeta).
export class NotEnoughInGoalError extends Error {}

export interface CreateGoalInput {
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: number;
  deadline: string | null;
  items?: { name: string; targetAmount: number }[];
}

export async function createGoal(userId: string, input: CreateGoalInput) {
  const groupId = await requireGroupId(userId);
  if ((input.items?.length ?? 0) > MAX_GOAL_ITEMS) throw new TooManyGoalItemsError();
  return insertGoal({ groupId, ...input });
}

export async function listGoals(userId: string) {
  const groupId = await requireGroupId(userId);
  return findGoalsByGroupId(groupId);
}

async function requireGoalInGroup(userId: string, goalId: string): Promise<{ groupId: string; goal: GoalRow }> {
  const groupId = await requireGroupId(userId);
  const goal = await findGoalById(goalId);
  if (!goal || goal.groupId !== groupId) {
    throw new GoalNotFoundError();
  }
  return { groupId, goal };
}

// ---------------------------------------------------------------------------
// Guardar e retirar
// ---------------------------------------------------------------------------

export interface MoveGoalMoneyInput {
  direction: "deposit" | "withdraw";
  amount: number;
  // Com submetas: pra qual (guardar) / de qual (retirar). Sem escolher: a
  // primeira que ainda falta (guardar) ou a que tem mais (retirar).
  itemId?: string | null;
  // "Tirar da conta" / "Voltar pra conta": a transferência aparece no extrato
  // dessa conta (mexe no saldo, não é gasto). null = só soma na meta.
  accountId?: string | null;
  // Da importação: data e nome da linha do extrato.
  occurredAt?: string;
  description?: string;
}

function pickItem(items: StoredGoalItem[], direction: "deposit" | "withdraw", itemId: string | null | undefined): number {
  if (itemId) {
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new GoalItemNotFoundError();
    return index;
  }
  if (direction === "deposit") {
    const open = items.findIndex((item) => item.currentCents < item.targetCents);
    return open >= 0 ? open : items.length - 1;
  }
  let best = 0;
  items.forEach((item, index) => {
    if (item.currentCents > items[best].currentCents) best = index;
  });
  return best;
}

// Numa transação do Firestore: a meta (e a submeta), o histórico e, se veio
// da conta, a transferência no extrato -- tudo junto ou nada.
export async function moveGoalMoney(userId: string, goalId: string, input: MoveGoalMoneyInput): Promise<GoalRow> {
  if (!(typeof input.amount === "number" && Number.isFinite(input.amount) && input.amount > 0)) {
    throw new InvalidContributionError();
  }
  const { groupId, goal } = await requireGoalInGroup(userId, goalId);
  const account = input.accountId ? await findUsableAccount(groupId, userId, input.accountId) : null;
  if (input.accountId && !account) throw new InvalidAccountError();

  const cents = toCents(input.amount);
  const signed = input.direction === "deposit" ? cents : -cents;
  const ref = goalRef(goalId);

  await runLedgerTransaction(groupId, async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) throw new GoalNotFoundError();
    const data = doc.data()!;
    const items = storedItems(data);
    let itemId: string | null = null;
    let itemName: string | null = null;
    let update: Record<string, unknown>;

    if (items.length > 0) {
      const index = pickItem(items, input.direction, input.itemId);
      if (items[index].currentCents + signed < 0) throw new NotEnoughInGoalError();
      const next = items.map((item, i) => (i === index ? { ...item, currentCents: item.currentCents + signed } : item));
      itemId = items[index].id;
      itemName = items[index].name;
      update = { items: next, ...goalTotals(data, next) };
    } else {
      const current = (data.currentAmountCents as number) + signed;
      if (current < 0) throw new NotEnoughInGoalError();
      update = goalTotals(data, [], { targetCents: data.targetAmountCents, currentCents: current });
    }

    let transactionId: string | null = null;
    if (account) {
      const deposit = input.direction === "deposit";
      transactionId = writeNewTransaction(t, {
        groupId,
        accountId: account.id,
        accountType: account.type,
        accountOwnerId: account.ownerUserId,
        categoryId: null,
        payerId: userId,
        createdBy: userId,
        description: input.description ?? (deposit ? `Guardado na meta ${goal.name}` : `Retirado da meta ${goal.name}`),
        amount: input.amount,
        // Guardar: sai da conta. Retirar: volta pra conta.
        transactionType: deposit ? "expense" : "income",
        occurredAt: input.occurredAt ?? todayInBrazil(),
        isPrivate: false,
        splitType: "none",
        transferKind: "goal",
        goalId,
      });
    }

    t.update(ref, update);
    t.set(contributionRef(goalId), {
      userId,
      amountCents: signed,
      itemId,
      itemName,
      accountId: account?.id ?? null,
      transactionId,
      createdAt: Date.now(),
    });
  });
  return (await findGoalById(goalId))!;
}

// Compatível com o "Guardar" antigo (só soma na meta).
export async function contributeToGoal(userId: string, goalId: string, amount: number) {
  return moveGoalMoney(userId, goalId, { direction: "deposit", amount });
}

export async function listContributions(userId: string, goalId: string) {
  await requireGoalInGroup(userId, goalId);
  return findContributions(goalId);
}

// ---------------------------------------------------------------------------
// Submetas
// ---------------------------------------------------------------------------

function cleanItemName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 60);
  return trimmed || null;
}

// Nova submeta. Meta que ainda não tinha: o que ela já tinha (alvo e
// guardado) vira a primeira submeta, "Geral", pra nada se perder.
export async function addGoalItem(userId: string, goalId: string, input: { name: unknown; targetAmount: unknown }): Promise<GoalRow> {
  const name = cleanItemName(input.name);
  const target = input.targetAmount;
  if (!name || typeof target !== "number" || !Number.isFinite(target) || target <= 0) throw new InvalidContributionError();
  const { groupId } = await requireGoalInGroup(userId, goalId);
  const ref = goalRef(goalId);
  await runLedgerTransaction(groupId, async (t) => {
    const data = (await t.get(ref)).data()!;
    let items = storedItems(data);
    if (items.length === 0 && ((data.targetAmountCents as number) > 0 || (data.currentAmountCents as number) > 0)) {
      items = [{ ...newGoalItem("Geral", 0), targetCents: data.targetAmountCents, currentCents: data.currentAmountCents }];
    }
    if (items.length >= MAX_GOAL_ITEMS) throw new TooManyGoalItemsError();
    const next = [...items, newGoalItem(name, target)];
    t.update(ref, { items: next, ...goalTotals(data, next) });
  });
  return (await findGoalById(goalId))!;
}

// Mudar nome ou preço de uma submeta (o preço da peça mudou).
export async function updateGoalItem(
  userId: string,
  goalId: string,
  itemId: string,
  input: { name?: unknown; targetAmount?: unknown }
): Promise<GoalRow> {
  const name = input.name !== undefined ? cleanItemName(input.name) : undefined;
  const target = input.targetAmount;
  if (name === null || (target !== undefined && (typeof target !== "number" || !Number.isFinite(target) || target <= 0))) {
    throw new InvalidContributionError();
  }
  const { groupId } = await requireGoalInGroup(userId, goalId);
  const ref = goalRef(goalId);
  await runLedgerTransaction(groupId, async (t) => {
    const data = (await t.get(ref)).data()!;
    const items = storedItems(data);
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) throw new GoalItemNotFoundError();
    const next = items.map((item, i) =>
      i === index
        ? { ...item, name: name ?? item.name, targetCents: typeof target === "number" ? toCents(target) : item.targetCents }
        : item
    );
    t.update(ref, { items: next, ...goalTotals(data, next) });
  });
  return (await findGoalById(goalId))!;
}

// Tirar uma submeta. O dinheiro dela nunca some: vai pra outra submeta (a
// primeira que sobrar). Era a última: a meta volta a ser simples, com esse
// dinheiro guardado e o mesmo alvo.
export async function removeGoalItem(userId: string, goalId: string, itemId: string): Promise<GoalRow> {
  const { groupId } = await requireGoalInGroup(userId, goalId);
  const ref = goalRef(goalId);
  await runLedgerTransaction(groupId, async (t) => {
    const data = (await t.get(ref)).data()!;
    const items = storedItems(data);
    const removed = items.find((item) => item.id === itemId);
    if (!removed) throw new GoalItemNotFoundError();
    const rest = items.filter((item) => item.id !== itemId);
    if (rest.length === 0) {
      t.update(ref, {
        items: [],
        ...goalTotals(data, [], { targetCents: removed.targetCents, currentCents: removed.currentCents }),
      });
      return;
    }
    rest[0] = { ...rest[0], currentCents: rest[0].currentCents + removed.currentCents };
    t.update(ref, { items: rest, ...goalTotals(data, rest) });
  });
  return (await findGoalById(goalId))!;
}

// ---------------------------------------------------------------------------
// Editar a meta e corrigir o histórico
// ---------------------------------------------------------------------------

export interface UpdateGoalInput {
  name: string;
  deadline: string | null;
  // Só em meta sem submetas (com submetas, o alvo é a soma delas).
  targetAmount?: number;
  // Só em meta sem submetas: "na verdade tem X guardado". A diferença entra
  // no histórico como ajuste (sem mexer em conta nenhuma).
  currentAmount?: number;
}

export async function updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<GoalRow> {
  const name = cleanItemName(input.name);
  const badAmount = (value: number | undefined, allowZero: boolean) =>
    value !== undefined && !(Number.isFinite(value) && (allowZero ? value >= 0 : value > 0));
  if (!name || badAmount(input.targetAmount, false) || badAmount(input.currentAmount, true)) {
    throw new InvalidContributionError();
  }
  const { groupId } = await requireGoalInGroup(userId, goalId);
  const ref = goalRef(goalId);
  await runLedgerTransaction(groupId, async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) throw new GoalNotFoundError();
    const data = doc.data()!;
    const items = storedItems(data);
    const update: Record<string, unknown> = { name, deadline: input.deadline, updatedAt: FieldValue.serverTimestamp() };
    if (items.length === 0) {
      const targetCents = input.targetAmount !== undefined ? toCents(input.targetAmount) : (data.targetAmountCents as number);
      const oldCurrent = data.currentAmountCents as number;
      const currentCents = input.currentAmount !== undefined ? toCents(input.currentAmount) : oldCurrent;
      Object.assign(update, goalTotals(data, [], { targetCents, currentCents }));
      if (currentCents !== oldCurrent) {
        t.set(contributionRef(goalId), {
          userId,
          amountCents: currentCents - oldCurrent,
          itemId: null,
          itemName: "Ajuste",
          accountId: null,
          transactionId: null,
          createdAt: Date.now(),
        });
      }
    }
    t.update(ref, update);
  });
  return (await findGoalById(goalId))!;
}

// Corrigir (`amount` > 0, no mesmo sentido: guardou/retirou) ou apagar
// (`amount` null) um registro do histórico. A meta (e a submeta) recalcula, e
// a transferência ligada no extrato muda ou some junto.
export async function updateContribution(
  userId: string,
  goalId: string,
  contributionId: string,
  amount: number | null
): Promise<GoalRow> {
  if (amount !== null && !(Number.isFinite(amount) && amount > 0)) {
    throw new InvalidContributionError();
  }
  const { groupId } = await requireGoalInGroup(userId, goalId);
  const ref = goalRef(goalId);
  const cRef = contributionDocRef(goalId, contributionId);
  await runLedgerTransaction(groupId, async (t) => {
    const [goalDoc, contributionDoc] = await Promise.all([t.get(ref), t.get(cRef)]);
    if (!goalDoc.exists || !contributionDoc.exists) throw new GoalNotFoundError();
    const data = goalDoc.data()!;
    const contribution = contributionDoc.data()!;
    const oldSigned = contribution.amountCents as number;
    const newSigned = amount === null ? 0 : Math.sign(oldSigned || 1) * toCents(amount);
    const delta = newSigned - oldSigned;
    const transactionId = (contribution.transactionId as string | null) ?? null;
    const removal = amount === null && transactionId ? await prepareTransactionDelete(t, transactionId) : null;
    const linkedExists =
      amount !== null && transactionId ? (await t.get(transactionDocRef(transactionId))).exists : false;

    const items = storedItems(data);
    if (items.length > 0) {
      // A submeta original, ou a primeira se ela já foi tirada.
      const index = Math.max(0, items.findIndex((item) => item.id === contribution.itemId));
      if (items[index].currentCents + delta < 0) throw new NotEnoughInGoalError();
      const next = items.map((item, i) => (i === index ? { ...item, currentCents: item.currentCents + delta } : item));
      t.update(ref, { items: next, ...goalTotals(data, next) });
    } else {
      const current = (data.currentAmountCents as number) + delta;
      if (current < 0) throw new NotEnoughInGoalError();
      t.update(ref, goalTotals(data, [], { targetCents: data.targetAmountCents, currentCents: current }));
    }

    if (amount === null) {
      removal?.apply();
      t.delete(cRef);
    } else {
      t.update(cRef, { amountCents: newSigned });
      if (transactionId && linkedExists) {
        t.update(transactionDocRef(transactionId), { amountCents: Math.abs(newSigned), updatedAt: FieldValue.serverTimestamp() });
      }
    }
  });
  return (await findGoalById(goalId))!;
}

// Excluir a meta: o que saiu da conta pra ela volta (as transferências somem
// do extrato, como no cartão garantido).
export async function removeGoal(userId: string, goalId: string) {
  await requireGoalInGroup(userId, goalId);
  await deleteTransactionsBatch(await findGoalTransferIds(goalId));
  await deleteGoal(goalId);
}

