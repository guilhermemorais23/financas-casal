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
// Guardar/resgatar de um cartão com limite garantido -- só muda pelo próprio
// cartão, pra o limite do cartão e a conta nunca discordarem.
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

// Uma série recorrente é gerada inteira na criação (sem cron): 2 ocorrências
// é o mínimo que vale chamar de "recorrente", e 36 (3 anos de assinatura ou
// aluguel) é um teto sensato, pra ninguém digitar sem querer um número de 4
// dígitos de meses num lote de gravação do Firestore.
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
  // Quando preenchido, gera `months` ocorrências (esta mais months-1, uma por
  // mês, no mesmo dia do mês, ajustado nos meses mais curtos) de uma vez, em
  // vez de só este lançamento.
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
    // As divisões registram quem deve quem num gasto compartilhado; receita não
    // tem dívida assim. Divide igual entre quantos membros o grupo tiver. Cada
    // ocorrência de uma série recorrente ganha as suas próprias divisões, igual a
    // um lançamento avulso.
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

// Mesmas regras de visibilidade da lista normal -- a exportação também nunca
// vaza lançamento pessoal privado de um colega de grupo. 10 mil é muito acima
// do que qualquer grupo teria num mês; o teto só protege a exportação de
// crescer sem limite se alguém chamar sem mês.
export async function exportTransactionsForUser(userId: string, monthParam?: string) {
  const groupId = await requireGroupId(userId);
  const range = monthParam ? parseMonthRange(monthParam) : undefined;
  return findTransactionsVisibleTo(groupId, userId, 10000, range);
}

// "Quem deve quem" par a par, entre todo par de membros com dívida de gasto
// compartilhado. Nenhuma tela mostra isto hoje.
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
  // Dinheiro líquido que foi da conta pessoal pra cartões com limite garantido
  // neste mês (depósitos menos resgates) -- não é gasto, mas saiu da conta,
  // então o número principal desconta, enquanto a "Saída do mês" e todos os
  // relatórios deixam de fora.
  savedInCards: number;
  // Mesma ideia pros Empréstimos: quanto saiu emprestado no mês (emprestado
  // menos recebido de volta).
  lentOut: number;
  net: number;
}

// Uma consulta cobre três coisas que o Painel precisa: a linha de tendência
// de 6 meses E (como a janela sempre inclui o mês atual e o anterior) os
// totais de entrada e saída deste mês e do passado -- o que antes custava
// mais duas buscas de até 100 lançamentos inteiros cada, só pra somar dois
// números. Escopo pessoal de propósito: bate exatamente com o que o número
// principal acima ("Você tem no mês") já significa, então os dois nunca
// discordam.
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
    if (!entry) continue; // fora da janela pedida -- não acontece com a faixa da própria consulta, fica por segurança
    if (row.isAccountsTransfer) {
      continue;
    } else if (row.isSecuredCardTransfer || row.isGoalTransfer) {
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

// Lançamentos da conta conjunta podem ser mexidos por qualquer membro do
// grupo (mesma regra das dívidas conjuntas); os da conta pessoal, só por quem
// criou.
export function canManageTransaction(userId: string, transaction: { accountType: string; createdBy: string }): boolean {
  return transaction.accountType === "joint" || transaction.createdBy === userId;
}

export async function deleteTransactionForUser(userId: string, transactionId: string) {
  const groupId = await requireGroupId(userId);
  const transaction = await findTransactionById(transactionId);
  if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
    throw new TransactionNotFoundError();
  }
  if (transaction.securedCardId || transaction.loanId || transaction.transferKind === "goal") {
    throw new SecuredCardTransferError(transaction.loanId ? "loan" : transaction.goalId ? "goal" : "card");
  }
  const linkKind = await linkKindOf(groupId, transaction);
  if (linkKind) {
    throw new LinkedTransactionError(linkKind);
  }
  await deleteTransaction(transactionId);
}

export const MAX_BULK_DELETE = 200;
export class InvalidBulkDeleteError extends Error {}

// Excluir vários de uma vez (um dia inteiro, ou os selecionados no
// relatório). Mesmas regras do excluir um por um: só o que a pessoa pode
// mexer, e nunca transferência (cartão garantido, empréstimo) nem lançamento
// criado por outra tela (fatura paga, parcela, reembolso, lista de compras) --
// esses voltam em `skipped`, com o motivo, e o resto é apagado.
export async function deleteTransactionsForUser(
  userId: string,
  transactionIds: string[]
): Promise<{ deleted: number; skipped: { id: string; reason: "not_found" | "transfer" | LinkKind }[] }> {
  const unique = [...new Set(transactionIds)];
  if (unique.length === 0 || unique.length > MAX_BULK_DELETE) throw new InvalidBulkDeleteError();
  const groupId = await requireGroupId(userId);
  const rows = await Promise.all(unique.map((id) => findTransactionById(id)));
  const skipped: { id: string; reason: "not_found" | "transfer" | LinkKind }[] = [];
  const deletable: string[] = [];
  await Promise.all(
    rows.map(async (transaction, index) => {
      const id = unique[index];
      if (!transaction || transaction.groupId !== groupId || !canManageTransaction(userId, transaction)) {
        skipped.push({ id, reason: "not_found" });
        return;
      }
      if (transaction.securedCardId || transaction.loanId || transaction.transferKind === "goal") {
        skipped.push({ id, reason: "transfer" });
        return;
      }
      const linkKind = await linkKindOf(groupId, transaction);
      if (linkKind) {
        skipped.push({ id, reason: linkKind });
        return;
      }
      deletable.push(id);
    })
  );
  await deleteTransactionsBatch(deletable);
  return { deleted: deletable.length, skipped };
}

export class NotSplitError extends Error {}
export class InvalidSettlementAmountError extends Error {}

// "Marcar como pago" -- diferente de uma simples marca, isto lança o
// dinheiro: cria uma receita de verdade com o que o(s) outro(s) membro(s)
// devolveu(ram) (um Pix, dinheiro...) na mesma conta do gasto original, pra
// o Painel e o saldo refletirem também, e não só uma etiqueta "ninguém deve
// mais". Mesmo padrão de lançamento ligado das dívidas, cartões e lista de
// compras: o settlementTransactionId no gasto original aponta pra ela, e
// reabrir ("em aberto" de novo) apaga -- o status da divisão e essa receita
// sempre andam juntos.
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

// "Cancelar esta assinatura/aluguel/salário" -- apaga esta ocorrência e todas
// as seguintes da mesma série, deixando as passadas (meses que já
// aconteceram) intactas no extrato.
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

// "O aluguel subiu" -- diferente de uma edição simples (que só mexe na
// ocorrência em que você clicou), isto reescreve valor e descrição nesta
// ocorrência e em todas as seguintes da mesma série, deixando as passadas
// exatamente como estavam. O mesmo alcance "esta e as futuras" do
// cancelRecurringForUser acima.
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
      // Cada ocorrência tem as suas próprias divisões (documentos separados,
      // criados por ocorrência quando a série foi gerada) -- mudar o valor exige
      // atualizar cada uma delas, igual a edição de um lançamento avulso faz com
      // as divisões dele.
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
  if (transaction.securedCardId || transaction.loanId || transaction.transferKind === "goal") {
    throw new SecuredCardTransferError(transaction.loanId ? "loan" : transaction.goalId ? "goal" : "card");
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

  // Mudar um lançamento de conta exige que a conta de destino também seja
  // deste grupo -- senão daria pra mover dinheiro (ou um gasto privado) pra
  // uma conta que ninguém aqui é dono, sem ninguém perceber. accountType e
  // accountOwnerId são copiados da conta pro lançamento na hora de gravar
  // (igual na criação) e precisam ser atualizados juntos sempre que o
  // accountId muda.
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

  // Mantém o "quem deve quem" coerente com o valor e o tipo editados: receita
  // não gera dívida, e as partes de um gasto dividido igual têm que acompanhar
  // o valor novo (ou aparecer, quando uma receita vira gasto). Vai no mesmo
  // lote da edição.
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
