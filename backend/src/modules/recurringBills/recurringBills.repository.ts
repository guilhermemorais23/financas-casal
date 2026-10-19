// CAMADA REPOSITORY (exemplo comentado das 4 camadas: este módulo).
// O repository é o único que conhece o formato do banco: o nome da coleção
// ("recurringBills"), os campos de cada documento e a conversão de dinheiro
// (no banco é centavo inteiro; pro resto do código é reais -- toCents e
// fromCents). Ele não decide nada: só lê, grava e devolve objetos (o tipo
// RecurringBillRow). Se o formato do banco mudar, só este arquivo muda.
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { fromCents, toCents } from "../../utils/money";
import type { SplitType, TransactionType } from "../transactions/transactions.repository";

// "Aluguel/assinaturas" -- diferente do recurringMonths de um lançamento (que
// gera de uma vez um lote fixo de ocorrências, ver transactions.service.ts),
// uma conta aqui é um cadastro permanente, sem data de fim: o cron diário
// (generateDueRecurringBills) cria um lançamento de verdade a partir dela
// sempre que chega o dia, mês após mês, até alguém pausar ou apagar.
// Como é o valor da conta:
// - fixed: sabe quanto é (aluguel, assinatura) -- lança sozinha no dia.
// - estimate: varia (água, luz) -- `amount` é a estimativa; não lança
//   sozinha, a pessoa confirma o valor real ("Já paguei").
// - unknown: não sabe ainda (celular) -- `amount` é null; só lembra.
export const AMOUNT_MODES = ["fixed", "estimate", "unknown"] as const;
export type AmountMode = (typeof AMOUNT_MODES)[number];

// Com quantos dias de antecedência avisar (Painel + notificação).
export const REMIND_DAYS = [0, 1, 3, 7] as const;
export const DEFAULT_REMIND_DAYS = 3;

export interface RecurringBillRow {
  id: string;
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  createdBy: string;
  payerId: string;
  categoryId: string | null;
  description: string;
  // null só quando amountMode é "unknown".
  amount: string | null;
  amountMode: AmountMode;
  remindDaysBefore: number;
  transactionType: TransactionType;
  isPrivate: boolean;
  splitType: SplitType;
  dayOfMonth: number;
  isActive: boolean;
  // "YYYY-MM" do último mês em que um lançamento foi gerado de fato pra esta
  // conta (ou tentado -- ver generateDueRecurringBills), ou null se nunca
  // rodou. É a trava do cron contra duplicado: nunca gera duas vezes no mesmo
  // mês, mesmo que rode mais de uma vez por dia.
  lastGeneratedMonth: string | null;
  // Contas sem valor certo: primeiro mês que conta ("YYYY-MM"). Antes dele
  // não há o que pagar (a conta foi criada depois do vencimento do mês).
  startMonth: string | null;
  // "Me lembre mais tarde": vale só pro mês pendente (snoozedMonth). Ou até
  // uma data, ou até o salário cair (snoozeSalarySince = desde quando
  // esperar uma receita de quem adiou, snoozedBy).
  snoozedMonth: string | null;
  snoozedUntil: string | null;
  snoozeSalarySince: string | null;
  snoozedBy: string | null;
  // Últimos valores reais pagos (centavos, mais antigo primeiro, até 3): a
  // estimativa passa a ser a média deles.
  recentAmountsCents: number[];
}

const recurringBillsCol = db.collection("recurringBills");

function toRow(doc: FirebaseFirestore.DocumentSnapshot): RecurringBillRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    accountId: data.accountId,
    accountType: data.accountType,
    accountOwnerId: data.accountOwnerId ?? null,
    createdBy: data.createdBy,
    payerId: data.payerId,
    categoryId: data.categoryId ?? null,
    description: data.description,
    amount: typeof data.amountCents === "number" ? fromCents(data.amountCents) : null,
    amountMode: AMOUNT_MODES.includes(data.amountMode) ? data.amountMode : "fixed",
    remindDaysBefore: typeof data.remindDaysBefore === "number" ? data.remindDaysBefore : DEFAULT_REMIND_DAYS,
    transactionType: data.transactionType,
    isPrivate: data.isPrivate ?? false,
    splitType: data.splitType ?? "none",
    dayOfMonth: data.dayOfMonth,
    isActive: data.isActive ?? true,
    lastGeneratedMonth: data.lastGeneratedMonth ?? null,
    startMonth: data.startMonth ?? null,
    snoozedMonth: data.snoozedMonth ?? null,
    snoozedUntil: data.snoozedUntil ?? null,
    snoozeSalarySince: data.snoozeSalarySince ?? null,
    snoozedBy: data.snoozedBy ?? null,
    recentAmountsCents: Array.isArray(data.recentAmountsCents) ? data.recentAmountsCents.filter((n: unknown) => typeof n === "number") : [],
  };
}

export { toRow as toRecurringBillRow };

export function recurringBillRef(id: string): FirebaseFirestore.DocumentReference {
  return recurringBillsCol.doc(id);
}

export async function insertRecurringBill(input: {
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  createdBy: string;
  payerId: string;
  categoryId: string | null;
  description: string;
  amount: number | null;
  amountMode: AmountMode;
  remindDaysBefore: number;
  startMonth: string | null;
  transactionType: TransactionType;
  isPrivate: boolean;
  splitType: SplitType;
  dayOfMonth: number;
}): Promise<RecurringBillRow> {
  const ref = await recurringBillsCol.add({
    groupId: input.groupId,
    accountId: input.accountId,
    accountType: input.accountType,
    accountOwnerId: input.accountOwnerId,
    createdBy: input.createdBy,
    payerId: input.payerId,
    categoryId: input.categoryId,
    description: input.description,
    amountCents: input.amount === null ? null : toCents(input.amount),
    amountMode: input.amountMode,
    remindDaysBefore: input.remindDaysBefore,
    startMonth: input.startMonth,
    recentAmountsCents: [],
    transactionType: input.transactionType,
    isPrivate: input.isPrivate,
    splitType: input.splitType,
    dayOfMonth: input.dayOfMonth,
    isActive: true,
    lastGeneratedMonth: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toRow(doc);
}

export async function findRecurringBillById(id: string): Promise<RecurringBillRow | null> {
  const doc = await recurringBillsCol.doc(id).get();
  return doc.exists ? toRow(doc) : null;
}

// Por grupo, pra lista que a pessoa vê -- o service aplica por cima a
// separação pessoal/conjunta (a mesma de toda outra lista por grupo do app).
export async function findRecurringBillsByGroupId(groupId: string): Promise<RecurringBillRow[]> {
  const snapshot = await recurringBillsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toRow);
}

// Só do cron: toda conta ativa de todos os grupos numa consulta só (um
// filtro de igualdade, sem índice composto) -- aqui não existe "usuário que
// pediu" pra filtrar por grupo antes, mesmo formato do
// reminders.repository.findAllGroupIds.
export async function findAllActiveRecurringBills(): Promise<RecurringBillRow[]> {
  const snapshot = await recurringBillsCol.where("isActive", "==", true).get();
  return snapshot.docs.map(toRow);
}

export async function updateRecurringBill(
  id: string,
  fields: {
    description?: string;
    amount?: number | null;
    amountMode?: AmountMode;
    remindDaysBefore?: number;
    startMonth?: string | null;
    dayOfMonth?: number;
    categoryId?: string | null;
    isActive?: boolean;
  }
): Promise<RecurringBillRow> {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.amount !== undefined) update.amountCents = fields.amount === null ? null : toCents(fields.amount);
  if (fields.amountMode !== undefined) update.amountMode = fields.amountMode;
  if (fields.remindDaysBefore !== undefined) update.remindDaysBefore = fields.remindDaysBefore;
  if (fields.startMonth !== undefined) update.startMonth = fields.startMonth;
  if (fields.dayOfMonth !== undefined) update.dayOfMonth = fields.dayOfMonth;
  if (fields.categoryId !== undefined) update.categoryId = fields.categoryId;
  if (fields.isActive !== undefined) update.isActive = fields.isActive;

  await recurringBillsCol.doc(id).update(update);
  const doc = await recurringBillsCol.doc(id).get();
  return toRow(doc);
}

export async function markRecurringBillGenerated(id: string, month: string): Promise<void> {
  await recurringBillsCol.doc(id).update({ lastGeneratedMonth: month });
}

// "Me lembre mais tarde" do mês pendente.
export async function setRecurringBillSnooze(
  id: string,
  snooze: { month: string; until: string | null; salarySince: string | null; by: string }
): Promise<void> {
  await recurringBillsCol.doc(id).update({
    snoozedMonth: snooze.month,
    snoozedUntil: snooze.until,
    snoozeSalarySince: snooze.salarySince,
    snoozedBy: snooze.by,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function deleteRecurringBill(id: string): Promise<void> {
  await recurringBillsCol.doc(id).delete();
}
