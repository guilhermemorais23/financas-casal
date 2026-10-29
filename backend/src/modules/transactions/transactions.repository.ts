import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { findVisibleCategories, replacementCategoryId } from "../categories/categories.repository";
import { fromCents, toCents } from "../../utils/money";
import { invalidateTransactionReads, memoizeReads } from "../../utils/readCache";

export type SplitType = "none" | "equal" | "proportional" | "by_category" | "custom";
export type TransactionType = "expense" | "income";
// Como foi pago de fato -- não depende de em qual conta do PAR. o lançamento
// está, nem de parcelamento (compra no cartão em 1x continua "crédito").
// Opcional: lançamentos antigos e os gerados por dívidas, faturas etc. ficam
// com null.
export const PAYMENT_METHODS = ["credit", "debit", "pix", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface TransactionRow {
  id: string;
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  categoryId: string | null;
  payerId: string;
  createdBy: string;
  description: string;
  amount: string;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
  paymentMethod: PaymentMethod | null;
  // Só preenchido em lançamentos gerados como parte de uma série recorrente
  // (assinatura, aluguel, salário...). recurringGroupId é o id da primeira
  // ocorrência da série (igual em todas, inclusive na primeira);
  // recurringIndex/recurringTotal dizem a posição dela na série (ex.: 3 de 12).
  // Lançamentos avulsos deixam os três null.
  recurringGroupId: string | null;
  recurringIndex: number | null;
  recurringTotal: number | null;
  // Só faz sentido quando splitType !== "none" -- se a parte do(s) outro(s)
  // membro(s) já foi acertada fora do app (um Pix, dinheiro...). É só uma marca
  // manual, ligada e desligada pelo extrato; não mexe no amountCents nem no
  // efeito real do lançamento no saldo da conta.
  isSettled: boolean;
  // Id do lançamento de receita de verdade criado quando isto foi marcado como
  // acertado (ver setSplitSettledForUser em transactions.service.ts) -- o mesmo
  // padrão de lançamento ligado das dívidas, cartões e lista de compras: "pago"
  // não é só uma marca, tem um lançamento real no extrato por trás, apagado de
  // novo se a divisão for reaberta. Null enquanto isSettled for false.
  settlementTransactionId: string | null;
  // Só preenchido em dinheiro que entrou ou saiu de um cartão com limite
  // garantido ("Guardar mais"/"Resgatar") -- é transferência, não gasto: muda o
  // saldo da conta (o dinheiro saiu mesmo), mas fica fora de todo total de
  // entrada e saída, pra relatórios e orçamento não contarem como gasto o
  // dinheiro guardado no cartão. Pertence ao cartão: apagar o cartão apaga
  // estes também, e eles não podem ser editados nem apagados sozinhos.
  securedCardId: string | null;
  // Preenchido só em dinheiro emprestado / recebido de volta pelos
  // Empréstimos -- uma transferência como o securedCardId acima: mexe no
  // saldo, nunca conta como gasto/receita. Pertence ao empréstimo
  // (editado/excluído só por ele).
  loanId: string | null;
  // Outras transferências (mexem no saldo, nunca contam como gasto/receita):
  // "goal" = dinheiro guardado numa meta ou retirado dela (goalId; só a tela
  // Metas desfaz); "accounts" = entre as suas contas (cada extrato traz o seu
  // lado, então o saldo de cada conta bate com o banco).
  transferKind: TransferKind | null;
  goalId: string | null;
  // Lançamento criado por outra tela (fatura paga, parcela de dívida,
  // reembolso de despesa dividida, item da lista de compras). Quem é dono
  // dele é essa tela: apagar ou mudar o valor por aqui deixaria a fatura
  // "paga" sem o dinheiro ter saído. Null nos lançamentos normais (e nos
  // antigos, de antes desse campo -- ver isLinkedTransaction no service).
  linkKind: LinkKind | null;
}

export type TransferKind = "goal" | "accounts";

export const LINK_KINDS = ["card_statement", "debt_installment", "settlement", "shopping"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

// Transferências movem dinheiro entre a conta e outro lugar (um cartão
// garantido, alguém que te deve) sem ser receita nem gasto.
export function isTransferData(data: FirebaseFirestore.DocumentData): boolean {
  return Boolean(data.securedCardId || data.loanId || data.transferKind);
}

export interface TransactionListRow extends TransactionRow {
  categoryName: string | null;
  categoryEmoji: string | null;
}

const transactionsCol = db.collection("transactions");

function toTransactionRow(doc: FirebaseFirestore.DocumentSnapshot): TransactionRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    accountId: data.accountId,
    accountType: data.accountType,
    accountOwnerId: data.accountOwnerId ?? null,
    categoryId: data.categoryId ?? null,
    payerId: data.payerId,
    createdBy: data.createdBy,
    description: data.description,
    amount: fromCents(data.amountCents),
    transactionType: data.transactionType,
    occurredAt: data.occurredAt,
    isPrivate: data.isPrivate,
    splitType: data.splitType,
    paymentMethod: data.paymentMethod ?? null,
    recurringGroupId: data.recurringGroupId ?? null,
    recurringIndex: data.recurringIndex ?? null,
    recurringTotal: data.recurringTotal ?? null,
    isSettled: data.isSettled ?? false,
    settlementTransactionId: data.settlementTransactionId ?? null,
    securedCardId: data.securedCardId ?? null,
    loanId: data.loanId ?? null,
    transferKind: data.transferKind ?? null,
    goalId: data.goalId ?? null,
    linkKind: data.linkKind ?? null,
  };
}

async function loadCategoriesMap(groupId: string): Promise<Map<string, { name: string; emoji: string | null }>> {
  const categories = await findVisibleCategories(groupId);
  return new Map(categories.map((c) => [c.id, { name: c.name, emoji: c.emoji }]));
}

// Lançamento que aponta pra uma categoria que o grupo não tem mais (apagada
// antes de a exclusão passar a mover tudo pra "Outros") é lido como "Outros"
// (ou "Receita", se for entrada). Não grava nada: só muda o que a leitura
// devolve, então Relatórios, Painel e Orçamento somam no lugar certo.
// Sem categoria (null) continua null -- é o que o aviso de classificar pega.
function resolveCategoryId(
  categoryId: string | null,
  transactionType: TransactionType,
  categoriesById: Map<string, unknown>
): string | null {
  if (!categoryId || categoriesById.has(categoryId)) return categoryId;
  return replacementCategoryId(transactionType === "income" ? "income" : "expense");
}

export interface NewTransactionInput {
  groupId: string;
  accountId: string;
  accountType: "personal" | "joint";
  accountOwnerId: string | null;
  categoryId: string | null;
  payerId: string;
  createdBy: string;
  description: string;
  amount: number;
  transactionType: TransactionType;
  occurredAt: string;
  isPrivate: boolean;
  splitType: SplitType;
  paymentMethod?: PaymentMethod | null;
  securedCardId?: string | null;
  loanId?: string | null;
  transferKind?: TransferKind | null;
  goalId?: string | null;
  linkKind?: LinkKind | null;
}

export interface SplitInput {
  userId: string;
  shareAmountCents: number;
}

// O que o lote (batch) e a transação do Firestore têm em comum pra gravar.
interface Writer {
  set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): unknown;
  delete(ref: FirebaseFirestore.DocumentReference): unknown;
}

function transactionData(
  base: Omit<NewTransactionInput, "occurredAt">,
  occurredAt: string,
  recurring: { groupId: string; index: number; total: number } | null
): FirebaseFirestore.DocumentData {
  return {
    groupId: base.groupId,
    accountId: base.accountId,
    accountType: base.accountType,
    accountOwnerId: base.accountOwnerId,
    categoryId: base.categoryId,
    payerId: base.payerId,
    createdBy: base.createdBy,
    description: base.description,
    amountCents: toCents(base.amount),
    transactionType: base.transactionType,
    occurredAt,
    isPrivate: base.isPrivate,
    splitType: base.splitType,
    paymentMethod: base.paymentMethod ?? null,
    recurringGroupId: recurring?.groupId ?? null,
    recurringIndex: recurring?.index ?? null,
    recurringTotal: recurring?.total ?? null,
    isSettled: false,
    settlementTransactionId: null,
    securedCardId: base.securedCardId ?? null,
    loanId: base.loanId ?? null,
    transferKind: base.transferKind ?? null,
    goalId: base.goalId ?? null,
    linkKind: base.linkKind ?? null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

// ID do documento = userId dentro da subcoleção -- equivale ao
// UNIQUE(transaction_id, user_id) do SQL. groupId e transactionId são
// copiados em cada divisão pra conta de saldos poder consultá-las juntas
// (collection group).
function writeSplits(writer: Writer, groupId: string, ref: FirebaseFirestore.DocumentReference, splits: SplitInput[]) {
  for (const split of splits) {
    writer.set(ref.collection("splits").doc(split.userId), {
      groupId,
      transactionId: ref.id,
      userId: split.userId,
      shareAmountCents: split.shareAmountCents,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

// Lote do Firestore aceita até 500 gravações; acima disso divide em vários.
const BATCH_LIMIT = 450;
async function commitInChunks(ops: ((writer: Writer) => void)[]): Promise<void> {
  for (let start = 0; start < ops.length; start += BATCH_LIMIT) {
    const batch = db.batch();
    ops.slice(start, start + BATCH_LIMIT).forEach((op) => op(batch));
    await batch.commit();
  }
}

export async function insertTransaction(input: NewTransactionInput, splits: SplitInput[] = []): Promise<TransactionRow> {
  const [row] = await insertTransactionSeries(input, [input.occurredAt], splits);
  return row;
}

// Grava todas as ocorrências de uma série recorrente (ou, com
// `occurredAtDates` de um item só, um lançamento simples -- o insertTransaction
// acima é exatamente esse caso) num lote só, cada uma com sua cópia de
// `splits`. As referências dos documentos são criadas antes, então o id da
// primeira ocorrência já é conhecido antes de gravar -- e é ele que toda
// ocorrência (inclusive a primeira) guarda como recurringGroupId, a alça
// usada depois pra achar/cancelar "esta e todas as futuras". Lançamento e
// divisões vão no mesmo lote: nunca fica uma despesa dividida sem as
// divisões.
export async function insertTransactionSeries(
  base: Omit<NewTransactionInput, "occurredAt">,
  occurredAtDates: string[],
  splits: SplitInput[] = []
): Promise<TransactionRow[]> {
  const refs = occurredAtDates.map(() => transactionsCol.doc());
  const isRecurring = occurredAtDates.length > 1;
  const recurringGroupId = isRecurring ? refs[0].id : null;

  await commitInChunks(
    refs.map((ref, index) => (writer: Writer) => {
      const recurring = recurringGroupId ? { groupId: recurringGroupId, index: index + 1, total: occurredAtDates.length } : null;
      writer.set(ref, transactionData(base, occurredAtDates[index], recurring));
      writeSplits(writer, base.groupId, ref, splits);
    })
  );
  invalidateTransactionReads(base.groupId);

  const docs = await db.getAll(...refs);
  return docs.map(toTransactionRow);
}

// Vários lançamentos soltos (não é uma série) de uma vez, em lotes -- a
// importação de extrato chega a 500 de uma vez.
export async function insertTransactionsBatch(inputs: NewTransactionInput[]): Promise<number> {
  if (inputs.length === 0) return 0;
  await commitInChunks(inputs.map((input) => (writer: Writer) => writer.set(transactionsCol.doc(), transactionData(input, input.occurredAt, null))));
  new Set(inputs.map((input) => input.groupId)).forEach((groupId) => invalidateTransactionReads(groupId));
  return inputs.length;
}

// O mesmo envio de importação duas vezes (clique duplo, rede repetindo) em
// poucos minutos: só o primeiro grava.
const importCommitsCol = db.collection("importCommits");
const IMPORT_DEDUPE_MS = 10 * 60 * 1000;
export async function claimImportCommit(fingerprint: string): Promise<boolean> {
  const ref = importCommitsCol.doc(fingerprint);
  return db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (doc.exists && (doc.data()!.at as number) > Date.now() - IMPORT_DEDUPE_MS) return false;
    t.set(ref, { at: Date.now() });
    return true;
  });
}

export async function releaseImportCommit(fingerprint: string): Promise<void> {
  await importCommitsCol.doc(fingerprint).delete();
}

// Pra usar dentro de db.runTransaction: grava um lançamento novo (e as
// divisões) junto com o que mais a transação gravar -- a fatura marcada como
// paga, a parcela, o empréstimo... Ou vai tudo, ou nada. Quem chama invalida
// o cache (invalidateTransactionReads) depois do commit.
export function writeNewTransaction(t: FirebaseFirestore.Transaction, input: NewTransactionInput, splits: SplitInput[] = []): string {
  const ref = transactionsCol.doc();
  t.set(ref, transactionData(input, input.occurredAt, null));
  writeSplits(t, input.groupId, ref, splits);
  return ref.id;
}

// Também dentro de db.runTransaction: lê o lançamento e as divisões (a
// transação do Firestore exige ler tudo antes de gravar) e devolve a função
// que apaga os dois. Lançamento que já não existe: não apaga nada.
export async function prepareTransactionDelete(
  t: FirebaseFirestore.Transaction,
  transactionId: string
): Promise<{ groupId: string | null; apply: () => void }> {
  const ref = transactionsCol.doc(transactionId);
  const [doc, splits] = await Promise.all([t.get(ref), t.get(ref.collection("splits"))]);
  return {
    groupId: doc.exists ? (doc.data()!.groupId as string) : null,
    apply: () => {
      splits.docs.forEach((split) => t.delete(split.ref));
      if (doc.exists) t.delete(ref);
    },
  };
}

// db.runTransaction + limpar o cache de leituras do grupo depois do commit.
export async function runLedgerTransaction<T>(groupId: string, fn: (t: FirebaseFirestore.Transaction) => Promise<T>): Promise<T> {
  const result = await db.runTransaction(fn);
  invalidateTransactionReads(groupId);
  return result;
}

export function transactionDocRef(transactionId: string): FirebaseFirestore.DocumentReference {
  return transactionsCol.doc(transactionId);
}

export { toTransactionRow };

// Todas as ocorrências com o mesmo recurringGroupId -- um filtro de
// igualdade só, sem índice composto. Quem chama (cancelRecurringForUser)
// filtra "esta e as futuras" em memória; uma série tem no máximo
// MAX_RECURRENCE_MONTHS (36) linhas, barato de qualquer jeito.
export async function findRecurringSeries(recurringGroupId: string): Promise<TransactionRow[]> {
  const snapshot = await transactionsCol.where("recurringGroupId", "==", recurringGroupId).get();
  return snapshot.docs.map(toTransactionRow);
}

export async function findGoalTransferIds(goalId: string): Promise<string[]> {
  const snapshot = await transactionsCol.where("goalId", "==", goalId).select().get();
  return snapshot.docs.map((doc) => doc.id);
}

export async function findSecuredCardTransferIds(cardId: string): Promise<string[]> {
  const snapshot = await transactionsCol.where("securedCardId", "==", cardId).select().get();
  return snapshot.docs.map((doc) => doc.id);
}

// Lançamentos de antes do linkKind: é o reembolso de alguma despesa dividida?
export async function isSettlementTransaction(transactionId: string): Promise<boolean> {
  const snapshot = await transactionsCol.where("settlementTransactionId", "==", transactionId).limit(1).select().get();
  return !snapshot.empty;
}

// Apaga lançamentos junto com as divisões deles, em lote.
export async function deleteTransactionsBatch(transactionIds: string[]): Promise<void> {
  if (transactionIds.length === 0) return;
  const refs = transactionIds.map((id) => transactionsCol.doc(id));
  const [docs, splitSnaps] = await Promise.all([
    db.getAll(...refs),
    Promise.all(refs.map((ref) => ref.collection("splits").get())),
  ]);
  const ops: ((writer: Writer) => void)[] = [];
  splitSnaps.forEach((snap) => snap.docs.forEach((split) => ops.push((writer) => writer.delete(split.ref))));
  refs.forEach((ref) => ops.push((writer) => writer.delete(ref)));
  await commitInChunks(ops);
  const groupIds = new Set(docs.filter((doc) => doc.exists).map((doc) => doc.data()!.groupId as string));
  groupIds.forEach((groupId) => invalidateTransactionReads(groupId));
}

export async function findTransactionsVisibleTo(
  groupId: string,
  requestingUserId: string,
  limit: number,
  range?: { monthStart: string; monthEnd: string },
  accountId?: string
): Promise<TransactionListRow[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint");
  let ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId);

  if (accountId) {
    jointQuery = jointQuery.where("accountId", "==", accountId);
    ownQuery = ownQuery.where("accountId", "==", accountId);
  }
  if (range) {
    jointQuery = jointQuery.where("occurredAt", ">=", range.monthStart).where("occurredAt", "<", range.monthEnd);
    ownQuery = ownQuery.where("occurredAt", ">=", range.monthStart).where("occurredAt", "<", range.monthEnd);
  }

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  const merged = [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });

  const categoriesById = await loadCategoriesMap(groupId);

  return merged
    .filter((doc) => {
      const data = doc.data();
      return data.isPrivate === false || data.createdBy === requestingUserId;
    })
    .sort((a, b) => {
      const occurredCompare = (b.data().occurredAt as string).localeCompare(a.data().occurredAt as string);
      if (occurredCompare !== 0) return occurredCompare;
      const aCreated = (a.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      const bCreated = (b.data().createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis() ?? 0;
      return bCreated - aCreated;
    })
    .slice(0, limit)
    .map((doc) => {
      const stored = toTransactionRow(doc);
      const row = { ...stored, categoryId: resolveCategoryId(stored.categoryId, stored.transactionType, categoriesById) };
      const category = row.categoryId ? categoriesById.get(row.categoryId) : undefined;
      return { ...row, categoryName: category?.name ?? null, categoryEmoji: category?.emoji ?? null };
    });
}

export async function findTransactionById(transactionId: string): Promise<TransactionRow | null> {
  const doc = await transactionsCol.doc(transactionId).get();
  if (!doc.exists) return null;
  return toTransactionRow(doc);
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  await deleteTransactionsBatch([transactionId]);
}

export async function updateTransaction(
  transactionId: string,
  fields: {
    description?: string;
    amount?: number;
    transactionType?: TransactionType;
    categoryId?: string | null;
    occurredAt?: string;
    payerId?: string;
    // null volta pra "não informado".
    paymentMethod?: PaymentMethod | null;
    // Mudar um lançamento de conta também exige mudar o accountType e o
    // accountOwnerId dele (copiados da conta na hora de gravar, pras consultas
    // de privacidade acima) -- o service descobre a conta de destino e passa os
    // três juntos, nunca só o accountId.
    accountId?: string;
    accountType?: "personal" | "joint";
    accountOwnerId?: string | null;
  },
  // undefined: as divisões ficam como estão; uma lista (vazia inclusive):
  // troca todas, no mesmo lote da edição.
  splits?: SplitInput[]
): Promise<TransactionRow> {
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.amount !== undefined) update.amountCents = toCents(fields.amount);
  if (fields.transactionType !== undefined) update.transactionType = fields.transactionType;
  if (fields.categoryId !== undefined) update.categoryId = fields.categoryId;
  if (fields.occurredAt !== undefined) update.occurredAt = fields.occurredAt;
  if (fields.payerId !== undefined) update.payerId = fields.payerId;
  if (fields.paymentMethod !== undefined) update.paymentMethod = fields.paymentMethod;
  if (fields.accountId !== undefined) update.accountId = fields.accountId;
  if (fields.accountType !== undefined) update.accountType = fields.accountType;
  if (fields.accountOwnerId !== undefined) update.accountOwnerId = fields.accountOwnerId;

  const ref = transactionsCol.doc(transactionId);
  const batch = db.batch();
  batch.update(ref, update);
  if (splits !== undefined) {
    const [current, existing] = await Promise.all([ref.get(), ref.collection("splits").get()]);
    existing.docs.forEach((split) => batch.delete(split.ref));
    if (current.exists) writeSplits(batch, current.data()!.groupId, ref, splits);
  }
  await batch.commit();
  const doc = await ref.get();
  invalidateTransactionReads(doc.data()?.groupId);
  return toTransactionRow(doc);
}

export interface AccountBalanceRow {
  accountId: string;
  balanceCents: number;
}

// Entrada menos saída por conta, calculado do zero a partir dos lançamentos
// toda vez (não existe saldo guardado -- ver as notas do esquema).
export function getAccountBalances(groupId: string): Promise<AccountBalanceRow[]> {
  return memoizeReads(`balances:${groupId}`, () => loadAccountBalances(groupId), groupId);
}

async function loadAccountBalances(groupId: string): Promise<AccountBalanceRow[]> {
  const snapshot = await transactionsCol.where("groupId", "==", groupId).select("accountId", "amountCents", "transactionType").get();
  const balances = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const delta = data.transactionType === "income" ? data.amountCents : -data.amountCents;
    balances.set(data.accountId, (balances.get(data.accountId) ?? 0) + delta);
  }
  return Array.from(balances.entries()).map(([accountId, balanceCents]) => ({ accountId, balanceCents }));
}

export interface CategorySummaryRow {
  categoryId: string | null;
  categoryName: string | null;
  categoryEmoji: string | null;
  total: string;
}

export interface PayerSummaryRow {
  payerId: string;
  total: string;
}

export type SummaryScope = "joint" | "visible" | "own";

// "joint": só o que sai da "Nossa Conta" -- usado pela tela Par, que é
// justamente sobre o orçamento compartilhado.
// "visible": conjunta + a conta pessoal de quem pede -- exatamente o que o
// findTransactionsVisibleTo devolve, então uma tela que mostra divisão por
// categoria e extrato juntos (Relatórios) nunca tem um contradizendo o outro.
// "own": só a conta pessoal de quem pede -- a mesma base do número do Painel
// e do fechamento do mês, pra "onde mais foi" bater com "saiu".
function fetchExpenseDocsForSummary(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return memoizeReads(`summaryDocs:${groupId}:${requestingUserId}:${monthStart}:${monthEnd}:${scope}`, () =>
    loadExpenseDocsForSummary(groupId, requestingUserId, monthStart, monthEnd, scope)
,
    groupId
  );
}

async function loadExpenseDocsForSummary(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint")
    .where("transactionType", "==", "expense")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  if (scope === "joint") {
    return (await jointQuery.get()).docs;
  }

  const ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId)
    .where("transactionType", "==", "expense")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  if (scope === "own") {
    return (await ownQuery.get()).docs;
  }

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  return [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

export async function getMonthlySummary(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope = "joint"
): Promise<{ byCategory: CategorySummaryRow[]; byPayer: PayerSummaryRow[]; total: string }> {
  const docs = await fetchExpenseDocsForSummary(groupId, requestingUserId, monthStart, monthEnd, scope);

  const categoriesById = await loadCategoriesMap(groupId);

  // Uma passada só pelos documentos -- byCategory (com a trava de privacidade),
  // byPayer (sem a trava, ver comentário abaixo) e o total vão somando juntos,
  // em vez de três voltas separadas na mesma lista.
  const byCategoryMap = new Map<string, { categoryId: string | null; total: number }>();
  const byPayerMap = new Map<string, number>();
  let totalCents = 0;

  for (const doc of docs) {
    const data = doc.data();
    if (isTransferData(data)) continue;
    totalCents += data.amountCents;
    byPayerMap.set(data.payerId, (byPayerMap.get(data.payerId) ?? 0) + data.amountCents);

    if (data.isPrivate === false || data.createdBy === requestingUserId) {
      const categoryId = resolveCategoryId(data.categoryId ?? null, data.transactionType, categoriesById);
      const key = categoryId ?? "none";
      const entry = byCategoryMap.get(key) ?? { categoryId, total: 0 };
      entry.total += data.amountCents;
      byCategoryMap.set(key, entry);
    }
  }
  const byCategory: CategorySummaryRow[] = Array.from(byCategoryMap.values())
    .map((entry) => {
      const category = entry.categoryId ? categoriesById.get(entry.categoryId) : undefined;
      return {
        categoryId: entry.categoryId,
        categoryName: category?.name ?? null,
        categoryEmoji: category?.emoji ?? null,
        total: fromCents(entry.total),
      };
    })
    .sort((a, b) => Number(b.total) - Number(a.total));

  // O byPayer de propósito NÃO respeita o isPrivate -- mantém a assimetria do
  // SQL original (o total gasto por pessoa de um casal é real, mesmo que a
  // descrição de um lançamento seja privada).
  const byPayer: PayerSummaryRow[] = Array.from(byPayerMap.entries()).map(([payerId, total]) => ({
    payerId,
    total: fromCents(total),
  }));

  return { byCategory, byPayer, total: fromCents(totalCents) };
}

export interface DailySeriesPoint {
  day: string;
  income: string;
  expense: string;
}

// Mesmo formato de consulta do findTransactionsVisibleTo (groupId +
// accountType/accountOwnerId + faixa de occurredAt, sem filtro de
// transactionType), então usa os índices compostos que já existem pro
// extrato -- sem índice novo. Diferente do fetchExpenseDocsForSummary, traz
// receitas e despesas, porque a série diária desenha as duas.
function fetchDocsForDateRange(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return memoizeReads(`rangeDocs:${groupId}:${requestingUserId}:${monthStart}:${monthEnd}:${scope}`, () =>
    loadDocsForDateRange(groupId, requestingUserId, monthStart, monthEnd, scope)
,
    groupId
  );
}

async function loadDocsForDateRange(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  let jointQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountType", "==", "joint")
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  if (scope === "joint") {
    return (await jointQuery.get()).docs;
  }

  const ownQuery: FirebaseFirestore.Query = transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", requestingUserId)
    .where("occurredAt", ">=", monthStart)
    .where("occurredAt", "<", monthEnd);

  const [jointSnap, ownSnap] = await Promise.all([jointQuery.get(), ownQuery.get()]);
  const seen = new Set<string>();
  return [...jointSnap.docs, ...ownSnap.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}

export interface OwnRangeDoc {
  month: string;
  date: string;
  amountCents: number;
  transactionType: TransactionType;
  isSecuredCardTransfer: boolean;
  isLoanTransfer: boolean;
  // Guardado numa meta (soma com o guardado no cartão: saiu da conta, é seu).
  isGoalTransfer: boolean;
  // Entre as suas contas: não é receita nem gasto.
  isAccountsTransfer: boolean;
}

// Uma consulta só pra faixa inteira, só a conta pessoal (accountOwnerId, e
// não o escopo de grupo mais amplo das consultas de resumo e série diária) --
// bate exatamente com o que o número principal do Painel ("Você tem no mês")
// já significa. Mesma combinação de igualdade + faixa do ramo "own" do
// fetchDocsForDateRange acima, então reaproveita um índice que já existe em
// vez de precisar publicar um índice composto novo.
export function findOwnDocsForRange(
  groupId: string,
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<OwnRangeDoc[]> {
  return memoizeReads(`ownDocs:${groupId}:${userId}:${rangeStart}:${rangeEnd}`, () =>
    loadOwnDocsForRange(groupId, userId, rangeStart, rangeEnd)
,
    groupId
  );
}

async function loadOwnDocsForRange(
  groupId: string,
  userId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<OwnRangeDoc[]> {
  const snapshot = await transactionsCol
    .where("groupId", "==", groupId)
    .where("accountOwnerId", "==", userId)
    .where("occurredAt", ">=", rangeStart)
    .where("occurredAt", "<", rangeEnd)
    .select("occurredAt", "amountCents", "transactionType", "securedCardId", "loanId", "transferKind")
    .get();
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      month: (data.occurredAt as string).slice(0, 7),
      date: (data.occurredAt as string).slice(0, 10),
      amountCents: data.amountCents as number,
      transactionType: data.transactionType as TransactionType,
      isSecuredCardTransfer: Boolean(data.securedCardId),
      isLoanTransfer: Boolean(data.loanId),
      isGoalTransfer: data.transferKind === "goal",
      isAccountsTransfer: data.transferKind === "accounts",
    };
  });
}

// Entrada e saída acumuladas por dia, do dia 1 até o último dia do mês -- um
// ponto por dia do calendário, pra linha não ter buracos, levando o total
// adiante nos dias sem lançamento. Sempre percorre o mês inteiro, não só até
// hoje: quem lança antes algo que vem mais tarde no mês (um salário ou uma
// conta que já sabe que cai dia 5, lançada no dia 1) espera que conte na
// hora -- parar em "hoje" fazia isso sumir sem aviso de todo widget que usa
// o dailyTrend (o Entrada x Saída do menu lateral, o gráfico acumulado) até
// o calendário chegar naquela data, mesmo com o total do mês na mesma tela
// já incluindo.
export async function getDailySeries(
  groupId: string,
  requestingUserId: string,
  monthStart: string,
  monthEnd: string,
  scope: SummaryScope = "visible"
): Promise<DailySeriesPoint[]> {
  const docs = await fetchDocsForDateRange(groupId, requestingUserId, monthStart, monthEnd, scope);

  const byDay = new Map<string, { income: number; expense: number }>();
  for (const doc of docs) {
    const data = doc.data();
    if (!(data.isPrivate === false || data.createdBy === requestingUserId)) continue;
    if (isTransferData(data)) continue;
    const entry = byDay.get(data.occurredAt) ?? { income: 0, expense: 0 };
    if (data.transactionType === "income") {
      entry.income += data.amountCents;
    } else {
      entry.expense += data.amountCents;
    }
    byDay.set(data.occurredAt, entry);
  }

  const lastDate = new Date(new Date(`${monthEnd}T00:00:00Z`).getTime() - 86_400_000);

  const points: DailySeriesPoint[] = [];
  let cumIncomeCents = 0;
  let cumExpenseCents = 0;
  for (
    const cursor = new Date(`${monthStart}T00:00:00Z`);
    cursor <= lastDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  ) {
    const day = cursor.toISOString().slice(0, 10);
    const entry = byDay.get(day);
    if (entry) {
      cumIncomeCents += entry.income;
      cumExpenseCents += entry.expense;
    }
    points.push({ day, income: fromCents(cumIncomeCents), expense: fromCents(cumExpenseCents) });
  }
  return points;
}

export interface MonthlyTotalPoint {
  month: string; // "YYYY-MM"
  income: string;
  expense: string;
}

export interface YearlySummary {
  year: number;
  months: MonthlyTotalPoint[];
  totalIncome: string;
  totalExpense: string;
}

// Um ponto por mês (jan a dez, sempre os 12, mesmo os vazios) do ano todo --
// reaproveita o fetchDocsForDateRange com uma faixa de um ano em vez de um
// mês; os mesmos índices compostos cobrem os dois, o Firestore não liga pro
// tamanho da faixa.
export async function getYearlySummary(
  groupId: string,
  requestingUserId: string,
  year: number,
  scope: SummaryScope = "visible"
): Promise<YearlySummary> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const docs = await fetchDocsForDateRange(groupId, requestingUserId, yearStart, yearEnd, scope);

  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const doc of docs) {
    const data = doc.data();
    if (!(data.isPrivate === false || data.createdBy === requestingUserId)) continue;
    if (isTransferData(data)) continue;
    const monthKey = (data.occurredAt as string).slice(0, 7);
    const entry = byMonth.get(monthKey) ?? { income: 0, expense: 0 };
    if (data.transactionType === "income") {
      entry.income += data.amountCents;
    } else {
      entry.expense += data.amountCents;
    }
    byMonth.set(monthKey, entry);
  }

  let totalIncomeCents = 0;
  let totalExpenseCents = 0;
  const months: MonthlyTotalPoint[] = [];
  for (let month = 1; month <= 12; month++) {
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const entry = byMonth.get(monthKey) ?? { income: 0, expense: 0 };
    totalIncomeCents += entry.income;
    totalExpenseCents += entry.expense;
    months.push({ month: monthKey, income: fromCents(entry.income), expense: fromCents(entry.expense) });
  }

  return { year, months, totalIncome: fromCents(totalIncomeCents), totalExpense: fromCents(totalExpenseCents) };
}

export interface BalanceRow {
  paidBy: string;
  owedBy: string;
  totalOwed: string;
}

// "Quem deve quem", calculado do zero a partir dos lançamentos + divisões
// (era uma VIEW no SQL; é a mesma conta, só que feita no Node, porque o
// Firestore não agrega no servidor).
//
// Evita de propósito o db.collectionGroup("splits") -- ele precisa de uma
// exceção de índice COLLECTION_GROUP (splits.groupId) que não é criada
// sozinha e pode demorar pra ficar pronta depois de publicada, na primeira
// vez que uma consulta precisa dela. Foi exatamente o que aconteceu na
// primeira vez que isto foi ligado a uma tela de verdade: erro 500 em
// produção até o índice terminar. Ler a subcoleção de divisões de cada
// lançamento não precisa de índice nenhum (um get() de subcoleção é sempre
// limitado ao documento pai) -- N leituras em vez de 1, mas N aqui é "gastos
// divididos ainda não acertados no grupo", longe de uma escala em que isso
// importe pra um app de casal ou grupo pequeno.
export function getBalanceRows(groupId: string): Promise<BalanceRow[]> {
  return memoizeReads(`balanceRows:${groupId}`, () => loadBalanceRows(groupId), groupId);
}

async function loadBalanceRows(groupId: string): Promise<BalanceRow[]> {
  const txSnapshot = await transactionsCol
    .where("groupId", "==", groupId)
    .where("transactionType", "==", "expense")
    .select("payerId", "splitType", "isSettled")
    .get();

  // Um lançamento que alguém já marcou como "pago" (acertado fora do app -- um
  // Pix, dinheiro...), ou que nunca foi dividido, não tem mais nada a somar
  // aqui.
  const relevantDocs = txSnapshot.docs.filter((doc) => {
    const data = doc.data();
    return data.splitType && data.splitType !== "none" && !data.isSettled;
  });
  if (relevantDocs.length === 0) return [];

  const splitsSnapshots = await Promise.all(relevantDocs.map((doc) => doc.ref.collection("splits").get()));

  const pairTotals = new Map<string, number>();
  relevantDocs.forEach((doc, index) => {
    const paidBy = doc.data().payerId as string;
    for (const splitDoc of splitsSnapshots[index].docs) {
      const data = splitDoc.data();
      if (data.userId === paidBy) continue;
      const key = `${paidBy}__${data.userId}`;
      pairTotals.set(key, (pairTotals.get(key) ?? 0) + data.shareAmountCents);
    }
  });

  return Array.from(pairTotals.entries()).map(([key, cents]) => {
    const [paidBy, owedBy] = key.split("__");
    return { paidBy, owedBy, totalOwed: fromCents(cents) };
  });
}
