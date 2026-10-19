import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
import { fromCents, splitEvenly, toCents } from "../../utils/money";

export interface CardRow {
  id: string;
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  closingDay: number;
  dueDay: number;
  // Opcional de propósito -- um cartão que alguém já tinha antes disto existir
  // continua funcionando igual, sem barra de limite, até a pessoa preencher.
  limit: string | null;
  // "secured" = cartão com limite garantido: o limite É dinheiro que a pessoa
  // guardou no cartão (só muda pelo adjustSecuredLimit, nunca digitado direto).
  // Cartões criados antes disto não têm o campo e são lidos como "normal".
  limitType: LimitType;
  // Só importa no "secured": se guardar/resgatar tiram (e devolvem) dinheiro
  // da conta do dono. false = o dinheiro já estava guardado num lugar que o app
  // não acompanha (poupança, caixinha), então o limite é espaço extra e o
  // saldo da conta não muda. Cartões de antes disto sempre lançavam a
  // transferência, então são lidos como true.
  securedFromAccount: boolean;
}

export type LimitType = "normal" | "secured";

export interface PurchaseRow {
  id: string;
  cardId: string;
  description: string;
  amount: string;
  categoryId: string | null;
  buyerId: string;
  purchaseDate: string;
  statementMonth: string;
  // Uma compra à vista (installmentsCount === 1) ou a N-ésima de uma
  // parcelada -- todas as parcelas da mesma compra têm o mesmo
  // purchaseGroupId, um documento por mês de fatura em que cai (mesmo padrão
  // do recurringGroupId dos lançamentos). Apagar uma parcela apaga só aquele
  // documento, de propósito -- ver removePurchase em cards.service.ts.
  installmentNumber: number;
  installmentsCount: number;
  purchaseGroupId: string;
}

export interface StatementRow {
  isPaid: boolean;
  paidAt: string | null;
  transactionId: string | null;
}

const cardsCol = db.collection("cards");

function toCardRow(doc: FirebaseFirestore.DocumentSnapshot): CardRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    groupId: data.groupId,
    ownerUserId: data.ownerUserId ?? null,
    createdBy: data.createdBy,
    name: data.name,
    closingDay: data.closingDay,
    dueDay: data.dueDay,
    limit: typeof data.limitCents === "number" ? fromCents(data.limitCents) : null,
    limitType: data.limitType === "secured" ? "secured" : "normal",
    securedFromAccount: data.securedFromAccount !== false,
  };
}

function toPurchaseRow(cardId: string, doc: FirebaseFirestore.DocumentSnapshot): PurchaseRow {
  const data = doc.data()!;
  return {
    id: doc.id,
    cardId,
    description: data.description,
    amount: fromCents(data.amountCents),
    categoryId: data.categoryId ?? null,
    buyerId: data.buyerId,
    purchaseDate: data.purchaseDate,
    statementMonth: data.statementMonth,
    // Compras de antes do parcelamento existir não têm nenhum dos dois campos --
    // cada uma delas é tratada como compra 1/1.
    installmentNumber: data.installmentNumber ?? 1,
    installmentsCount: data.installmentsCount ?? 1,
    purchaseGroupId: data.purchaseGroupId ?? doc.id,
  };
}

function toStatementRow(doc: FirebaseFirestore.DocumentSnapshot): StatementRow {
  const data = doc.data();
  return {
    isPaid: data?.isPaid ?? false,
    paidAt: data?.paidAt ? data.paidAt.toDate().toISOString() : null,
    transactionId: data?.transactionId ?? null,
  };
}

export async function insertCard(input: {
  groupId: string;
  ownerUserId: string | null;
  createdBy: string;
  name: string;
  closingDay: number;
  dueDay: number;
  limit: number | null;
  limitType: LimitType;
  securedFromAccount: boolean;
}): Promise<CardRow> {
  const ref = await cardsCol.add({
    groupId: input.groupId,
    ownerUserId: input.ownerUserId,
    createdBy: input.createdBy,
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    limitCents: input.limit !== null ? toCents(input.limit) : null,
    limitType: input.limitType,
    securedFromAccount: input.securedFromAccount,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const doc = await ref.get();
  return toCardRow(doc);
}

export function findCardsVisibleTo(groupId: string, userId: string): Promise<CardRow[]> {
  return memoizeScoped(`cardsVisible:${groupId}:${userId}`, [`group:${groupId}`, "cards"], () => loadFindCardsVisibleTo(groupId, userId));
}

async function loadFindCardsVisibleTo(groupId: string, userId: string): Promise<CardRow[]> {
  const [jointSnap, ownSnap] = await Promise.all([
    cardsCol.where("groupId", "==", groupId).where("ownerUserId", "==", null).get(),
    cardsCol.where("groupId", "==", groupId).where("ownerUserId", "==", userId).get(),
  ]);
  return [...jointSnap.docs, ...ownSnap.docs].map(toCardRow).sort((a, b) => (a.id < b.id ? 1 : -1));
}

// Todos os cartões do grupo, de qualquer dono -- diferente do
// findCardsVisibleTo, não se limita "ao que um usuário pode ver" (um filtro
// de igualdade só, sem índice novo). Usado pelo job de lembretes, que roda
// fora do pedido de qualquer usuário e decide, por cartão, pra quem mandar
// e-mail pelo próprio ownerUserId (null -> todo mundo do grupo, preenchido ->
// só o dono).
export function findCardsByGroupId(groupId: string): Promise<CardRow[]> {
  return memoizeScoped(`cards:${groupId}`, [`group:${groupId}`, "cards"], () => loadFindCardsByGroupId(groupId));
}

async function loadFindCardsByGroupId(groupId: string): Promise<CardRow[]> {
  const snapshot = await cardsCol.where("groupId", "==", groupId).get();
  return snapshot.docs.map(toCardRow);
}

export async function findCardById(cardId: string): Promise<CardRow | null> {
  const doc = await cardsCol.doc(cardId).get();
  if (!doc.exists) return null;
  return toCardRow(doc);
}

export async function updateCard(
  cardId: string,
  input: { name: string; closingDay: number; dueDay: number; limit?: number | null }
): Promise<CardRow> {
  const ref = cardsCol.doc(cardId);
  const update: Record<string, unknown> = {
    name: input.name,
    closingDay: input.closingDay,
    dueDay: input.dueDay,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.limit !== undefined) {
    update.limitCents = input.limit !== null ? toCents(input.limit) : null;
  }
  await ref.update(update);
  const doc = await ref.get();
  return toCardRow(doc);
}

// Depósito (positivo) ou retirada (negativo) no limite de um cartão
// garantido -- é um incremento, então duas pessoas mexendo ao mesmo tempo não
// apagam o valor uma da outra. A trava "não dá pra retirar mais do que está
// livre" fica no service, que sabe quanto do limite as compras estão
// segurando.
export async function setCardSecuredFromAccount(cardId: string, securedFromAccount: boolean): Promise<CardRow> {
  const ref = cardsCol.doc(cardId);
  await ref.update({ securedFromAccount, updatedAt: FieldValue.serverTimestamp() });
  const doc = await ref.get();
  return toCardRow(doc);
}

export function cardRef(cardId: string): FirebaseFirestore.DocumentReference {
  return cardsCol.doc(cardId);
}

export function statementRef(cardId: string, statementMonth: string): FirebaseFirestore.DocumentReference {
  return cardsCol.doc(cardId).collection("statements").doc(statementMonth);
}

export { toCardRow };

export async function deleteCard(cardId: string): Promise<string[]> {
  const purchasesSnap = await cardsCol.doc(cardId).collection("purchases").get();
  const statementsSnap = await cardsCol.doc(cardId).collection("statements").get();
  const linkedTransactionIds = statementsSnap.docs
    .map((doc) => doc.data().transactionId as string | null)
    .filter((id): id is string => Boolean(id));

  // Cartão com anos de parcelas passa fácil das 500 gravações de um lote; o
  // cartão em si vai por último, então se algo falhar no meio dá pra tentar
  // de novo.
  const refs = [...purchasesSnap.docs.map((doc) => doc.ref), ...statementsSnap.docs.map((doc) => doc.ref)];
  for (let start = 0; start < refs.length; start += 450) {
    const batch = db.batch();
    refs.slice(start, start + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  await cardsCol.doc(cardId).delete();

  return linkedTransactionIds;
}

// A parcela 1/N cai em `statementMonth` (o mês em que cai a data da compra);
// a parcela 2/N no mês seguinte, e assim por diante -- todas as parcelas
// dividem um valor só via splitEvenly (o mesmo utilitário das dívidas) e um
// purchaseGroupId. count === 1 é a compra à vista e gera exatamente um
// documento, igual o antigo insertPurchase.
export async function insertPurchaseSeries(
  cardId: string,
  input: {
    description: string;
    amount: number;
    categoryId: string | null;
    buyerId: string;
    purchaseDate: string;
    count: number;
  },
  statementMonthsForEachInstallment: string[]
): Promise<PurchaseRow[]> {
  const col = cardsCol.doc(cardId).collection("purchases");
  const refs = statementMonthsForEachInstallment.map(() => col.doc());
  const purchaseGroupId = refs[0].id;
  const shares = splitEvenly(input.amount, input.count);

  const batch = db.batch();
  refs.forEach((ref, index) => {
    batch.set(ref, {
      description: input.description,
      // O splitEvenly já devolve centavos, diferente de todo outro campo de
      // dinheiro aqui (que recebe reais e converte com toCents) -- sem converter
      // duas vezes.
      amountCents: shares[index],
      categoryId: input.categoryId,
      buyerId: input.buyerId,
      purchaseDate: input.purchaseDate,
      statementMonth: statementMonthsForEachInstallment[index],
      installmentNumber: index + 1,
      installmentsCount: input.count,
      purchaseGroupId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  const docs = await Promise.all(refs.map((ref) => ref.get()));
  return docs.map((doc) => toPurchaseRow(cardId, doc));
}

// Todas as compras do cartão, de qualquer mês de fatura -- usado pra calcular
// quanto do limite está preso agora (toda parcela ainda não paga, que pode ir
// vários meses pra frente). Barato: o histórico inteiro de um cartão fica na
// casa das centenas de documentos, não compensa consultar por faixa de mês.
export function findAllPurchasesByCardId(cardId: string): Promise<PurchaseRow[]> {
  return memoizeScoped(`purchases:${cardId}`, ["cards"], () => loadFindAllPurchasesByCardId(cardId));
}

async function loadFindAllPurchasesByCardId(cardId: string): Promise<PurchaseRow[]> {
  const snapshot = await cardsCol.doc(cardId).collection("purchases").get();
  return snapshot.docs.map((doc) => toPurchaseRow(cardId, doc));
}

export async function findPurchasesByCardAndStatement(
  cardId: string,
  statementMonth: string
): Promise<PurchaseRow[]> {
  const snapshot = await cardsCol
    .doc(cardId)
    .collection("purchases")
    .where("statementMonth", "==", statementMonth)
    .get();
  return snapshot.docs
    .map((doc) => toPurchaseRow(cardId, doc))
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
}

export async function findPurchaseById(cardId: string, purchaseId: string): Promise<PurchaseRow | null> {
  const doc = await cardsCol.doc(cardId).collection("purchases").doc(purchaseId).get();
  if (!doc.exists) return null;
  return toPurchaseRow(cardId, doc);
}

export async function deletePurchase(cardId: string, purchaseId: string): Promise<void> {
  await cardsCol.doc(cardId).collection("purchases").doc(purchaseId).delete();
}

// Todas as faturas do cartão numa consulta só (antes era uma leitura por mês).
export function findStatementsByCardId(cardId: string): Promise<Map<string, StatementRow>> {
  return memoizeScoped(`statements:${cardId}`, ["cards"], async () => {
    const snapshot = await cardsCol.doc(cardId).collection("statements").get();
    return new Map(snapshot.docs.map((doc) => [doc.id, toStatementRow(doc)]));
  });
}

export function findStatement(cardId: string, statementMonth: string): Promise<StatementRow | null> {
  return memoizeScoped(`statement:${cardId}:${statementMonth}`, ["cards"], () => loadFindStatement(cardId, statementMonth));
}

async function loadFindStatement(cardId: string, statementMonth: string): Promise<StatementRow | null> {
  const doc = await cardsCol.doc(cardId).collection("statements").doc(statementMonth).get();
  if (!doc.exists) return null;
  return toStatementRow(doc);
}

