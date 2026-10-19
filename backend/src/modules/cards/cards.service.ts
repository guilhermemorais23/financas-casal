import { FieldValue } from "firebase-admin/firestore";
import { categoryIsVisibleTo } from "../categories/categories.repository";
import { findAccountForOwner, findMembersByGroupId } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import {
  deleteTransactionsBatch,
  findSecuredCardTransferIds,
  insertTransaction,
  prepareTransactionDelete,
  runLedgerTransaction,
  writeNewTransaction,
  type NewTransactionInput,
} from "../transactions/transactions.repository";
import { addMonths, dateForDayInMonth, todayInBrazil } from "../../utils/month";
import {
  deleteCard,
  deletePurchase,
  findAllPurchasesByCardId,
  findCardById,
  findCardsVisibleTo,
  findPurchaseById,
  findPurchasesByCardAndStatement,
  findStatement,
  findStatementsByCardId,
  cardRef,
  setCardSecuredFromAccount,
  insertCard,
  insertPurchaseSeries,
  statementRef,
  toCardRow,
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

export type CardScope = "personal" | "joint";

// O que o formulário de compra oferece -- de 1x a 12x, mas só os números
// "redondos" (do jeito que a própria fatura escreveria), não todo inteiro no
// meio. Conferido aqui também, não só no <select> do frontend, pra que a API
// diga de verdade o que é permitido.
export const ALLOWED_INSTALLMENT_COUNTS = [1, 2, 3, 4, 6, 12];

export interface CreateCardInput {
  name: string;
  closingDay: number;
  dueDay: number;
  scope: CardScope;
  limit: number | null;
  limitType: LimitType;
  // Cartão garantido: true = o dinheiro sai da conta hoje (lançado como
  // transferência); false = já estava guardado fora do app, então o limite é
  // espaço extra e a conta não é tocada. O padrão é true.
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
  // Só calculado quando o cartão tem limite -- num cartão sem limite, o
  // findAllPurchasesByCardId e as leituras de fatura por mês seriam à toa, e o
  // frontend nem tem barra pra desenhar.
  limitUsed: string | null;
  // Uma linha por fatura não paga (da mais antiga): quanto do limite volta
  // quando aquela fatura for paga e quanto fica livre logo depois -- a linha do
  // tempo "quando o limite volta". Vazio sem limite.
  limitReleases: LimitRelease[];
}

export interface LimitRelease {
  month: string;
  dueDate: string;
  amount: string;
  availableAfter: string;
}

// Toda parcela (de qualquer mês de fatura, inclusive meses no futuro) cuja
// fatura ainda não foi marcada como paga, somada por mês de fatura -- uma
// compra parcelada prende o valor INTEIRO no limite assim que é feita, igual
// um cartão de verdade, e só libera cada parcela quando a fatura daquele mês
// é paga.
async function computeUnpaidByMonth(cardId: string): Promise<Map<string, number>> {
  const purchases = await findAllPurchasesByCardId(cardId);
  const byMonth = new Map<string, number>();
  if (purchases.length === 0) return byMonth;

  const statements = await findStatementsByCardId(cardId);
  const paidMonths = new Set([...statements.entries()].filter(([, statement]) => statement.isPaid).map(([month]) => month));

  for (const purchase of purchases) {
    if (paidMonths.has(purchase.statementMonth)) continue;
    const cents = Math.round(Number(purchase.amount) * 100);
    byMonth.set(purchase.statementMonth, (byMonth.get(purchase.statementMonth) ?? 0) + cents);
  }
  return byMonth;
}

// Quanto do limite as compras em aberto prendem (todas as faturas não pagas).
export async function limitUsedCents(cardId: string): Promise<number> {
  return sumCents(await computeUnpaidByMonth(cardId));
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

// Compras do dia 1 até o closingDay entram na fatura daquele mesmo mês;
// compras depois do closingDay vão pra fatura do mês seguinte -- igual o
// ciclo de um cartão de verdade, não importa em que dia a pessoa cadastra a
// compra.
function statementMonthFor(purchaseDate: string, closingDay: number): string {
  const [year, month, day] = purchaseDate.split("-").map(Number);
  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  return day <= closingDay ? monthParam : addMonths(monthParam, 1);
}

// Exportado pelo mesmo motivo do dueDateFor logo abaixo.
export function currentStatementMonth(closingDay: number): string {
  return statementMonthFor(todayInBrazil(), closingDay);
}

// O dueDay normalmente vem antes do closingDay no calendário (fecha dia 28,
// vence dia 5 do mês seguinte), mas também pode ser no mesmo mês (fecha dia
// 5, vence dia 12) -- comparar os dois dias diz em que mês o vencimento cai.
// Exportado: o job de lembretes (fora do pedido de qualquer usuário) precisa
// da mesma conta pra saber quando a fatura atual de um cartão vai vencer.
// O dueDay é limitado ao último dia real do mês -- um cartão que vence dia 31
// (permitido no cadastro: qualquer dia de 1 a 31) geraria uma data
// impossível como "2026-04-31" em abril/junho/setembro/novembro/fevereiro, o
// que quebrava sem aviso o "vence em X dias" do Painel (o Date do JS joga um
// dia inválido pro mês seguinte em vez de dar erro, então a contagem e a cor
// de urgência eram calculadas contra a data errada). Mesma regra que o
// dateForDayInMonth já usa nas dívidas.
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
  // O limite de um cartão garantido é o dinheiro colocado nele, então ele
  // começa com o primeiro depósito -- sem isso não há o que acompanhar.
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

// A conta por onde passa o dinheiro do cartão -- a conta pessoal do dono num
// cartão pessoal, a "Nossa Conta" num conjunto. Mesma regra do pagamento da
// fatura.
async function accountForCard(groupId: string, card: CardRow) {
  const account = await findAccountForOwner(groupId, card.ownerUserId);
  if (!account) {
    throw new CardNotFoundError();
  }
  return account;
}

// Guardar no cartão = o dinheiro sai da conta (e aparece no extrato no dia em
// que aconteceu); resgatar = ele volta. Lançado como transferência
// (securedCardId), então mexe no saldo sem contar como gasto ou receita em
// lugar nenhum.
async function securedTransferInput(
  userId: string,
  groupId: string,
  card: CardRow,
  direction: "deposit" | "withdraw",
  amount: number
): Promise<NewTransactionInput> {
  const account = await accountForCard(groupId, card);
  return {
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
    occurredAt: todayInBrazil(),
    isPrivate: false,
    splitType: "none",
    securedCardId: card.id,
  };
}

async function recordSecuredTransfer(
  userId: string,
  groupId: string,
  card: CardRow,
  direction: "deposit" | "withdraw",
  amount: number
) {
  await insertTransaction(await securedTransferInput(userId, groupId, card, direction, amount));
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
  // 1 = à vista (o padrão, e a única opção antes do parcelamento existir) --
  // qualquer outro número gera essa quantidade de parcelas, uma por mês de
  // fatura seguido, a partir do mês da própria compra.
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

  const purchases = await insertPurchaseSeries(
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
  // Compra que passou dos 80% do limite: avisa na hora. Falha no aviso não
  // atrapalha a compra.
  if (card.limit !== null && purchaseListener) {
    void purchaseListener(groupId, cardId).catch(() => {});
  }
  return purchases;
}

// O módulo de lembretes (que já depende deste) se registra aqui pra avisar do
// limite logo depois de cada compra, sem import circular.
type PurchaseListener = (groupId: string, cardId: string) => Promise<void>;
let purchaseListener: PurchaseListener | null = null;
export function onCardPurchase(listener: PurchaseListener): void {
  purchaseListener = listener;
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

// Mesma ideia das parcelas de dívida: pagar a fatura lança um gasto de
// verdade na conta do cartão, dividido por pessoa pelo que cada uma comprou
// de fato (não dividido igual) -- quem marca como paga é quem pagou, e as
// partes alimentam o "quem deve quem" do resto do grupo.
export async function setStatementPaidForUser(
  userId: string,
  cardId: string,
  month: string,
  isPaid: boolean
) {
  const { groupId, card } = await requireManageableCard(userId, cardId);
  const existing = await findStatement(cardId, month);
  const ref = statementRef(cardId, month);

  // Lançamento, divisões e a fatura marcada como paga vão juntos numa
  // transação do Firestore, que relê a fatura: dois cliques em "Pagar" (ou a
  // rede repetindo o pedido) não lançam a fatura duas vezes.
  if (isPaid && !existing?.isPaid) {
    const purchases = await findPurchasesByCardAndStatement(cardId, month);
    if (purchases.length === 0) {
      throw new PurchaseNotFoundError();
    }

    const account = await accountForCard(groupId, card);

    const totalAmount = purchases.reduce((sum, purchase) => sum + Number(purchase.amount), 0);
    const byBuyerCents = new Map<string, number>();
    for (const purchase of purchases) {
      const cents = Math.round(Number(purchase.amount) * 100);
      byBuyerCents.set(purchase.buyerId, (byBuyerCents.get(purchase.buyerId) ?? 0) + cents);
    }

    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(ref);
      if (current.exists && current.data()!.isPaid) return;
      const transactionId = writeNewTransaction(
        t,
        {
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
          linkKind: "card_statement",
        },
        Array.from(byBuyerCents.entries()).map(([buyerId, shareAmountCents]) => ({ userId: buyerId, shareAmountCents }))
      );
      t.set(ref, { isPaid: true, paidAt: FieldValue.serverTimestamp(), transactionId }, { merge: true });
    });
    return (await findStatement(cardId, month))!;
  }

  if (!isPaid && existing?.isPaid) {
    await runLedgerTransaction(groupId, async (t) => {
      const current = await t.get(ref);
      if (!current.exists || !current.data()!.isPaid) return;
      const transactionId = current.data()!.transactionId as string | null;
      const removal = transactionId ? await prepareTransactionDelete(t, transactionId) : null;
      removal?.apply();
      t.set(ref, { isPaid: false, paidAt: null, transactionId: null }, { merge: true });
    });
    return (await findStatement(cardId, month))!;
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
  // O limite de um cartão garantido só muda por depósito/retirada, então o
  // histórico sempre bate com o dinheiro que está guardado nele.
  if (card.limitType === "secured" && input.limit !== undefined) {
    throw new NotSecuredCardError();
  }
  return updateCard(cardId, input);
}

// Cartão com limite garantido: "Guardar mais" aumenta o limite exatamente no
// valor depositado; "Resgatar" diminui, mas só até o que as compras não estão
// segurando -- o resto fica preso até essas faturas serem pagas, igual o
// banco faria.
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
  const deltaCents = input.direction === "deposit" ? amountCents : -amountCents;
  // O quanto as compras em aberto prendem do limite (lido fora da transação:
  // compras novas não mudam o que já estava preso).
  const heldCents = input.direction === "withdraw" ? sumCents(await computeUnpaidByMonth(cardId)) : 0;
  const transfer = card.securedFromAccount
    ? await securedTransferInput(userId, groupId, card, input.direction, amountCents / 100)
    : null;

  // O limite é relido dentro da transação: dois resgates ao mesmo tempo não
  // tiram mais do que está livre.
  await runLedgerTransaction(groupId, async (t) => {
    const current = toCardRow(await t.get(cardRef(cardId)));
    if (input.direction === "withdraw") {
      const availableCents = Math.round(Number(current.limit ?? 0) * 100) - heldCents;
      if (amountCents > availableCents) {
        throw new InsufficientAvailableLimitError();
      }
    }
    t.update(cardRef(cardId), { limitCents: FieldValue.increment(deltaCents), updatedAt: FieldValue.serverTimestamp() });
    if (transfer) writeNewTransaction(t, transfer);
  });
  return (await findCardById(cardId))!;
}

// "Esse dinheiro saiu da minha conta?" -- dá pra corrigir depois. Desligar
// tira do extrato todos os lançamentos de guardar/resgatar (a conta volta a
// ser o que era, o limite continua); ligar lança o dinheiro guardado hoje no
// cartão como um guardar só, com data de hoje.
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
  // O que ainda estava guardado no cartão volta pra conta: os lançamentos de
  // guardar/resgatar somem junto com o cartão.
  const transferIds = await findSecuredCardTransferIds(cardId);
  const linkedTransactionIds = await deleteCard(cardId);
  await deleteTransactionsBatch([...linkedTransactionIds, ...transferIds]);
}
