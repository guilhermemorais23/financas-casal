import { db } from "../../db/firestore";

// One shared code pool for every channel -- a code generated for "vincular
// conta" doesn't care yet whether it's about to be redeemed on Telegram or
// WhatsApp, only consumeLinkCode's caller (whichever webhook receives it
// first) decides that.
const linkCodesCol = db.collection("telegramLinkCodes");
const linksCol = db.collection("telegramLinks");
const whatsappLinksCol = db.collection("whatsappLinks");

export interface TelegramLink {
  chatId: string;
  userId: string;
  groupId: string;
}

export interface WhatsappLink {
  waId: string;
  userId: string;
  groupId: string;
}

export async function saveLinkCode(code: string, userId: string, groupId: string, expiresAt: number) {
  await linkCodesCol.doc(code).set({ userId, groupId, expiresAt });
}

// One-shot: a code is deleted the moment it's read, valid or not, so it
// can never be replayed even if the caller ignores the null return.
export async function consumeLinkCode(code: string): Promise<{ userId: string; groupId: string } | null> {
  // Lido e apagado na mesma transação: o mesmo código mandado no Telegram e
  // no WhatsApp ao mesmo tempo só vincula um deles.
  const ref = linkCodesCol.doc(code);
  const data = await db.runTransaction(async (t) => {
    const doc = await t.get(ref);
    if (!doc.exists) return null;
    t.delete(ref);
    return doc.data()!;
  });
  if (!data || data.expiresAt < Date.now()) return null;
  return { userId: data.userId, groupId: data.groupId };
}

// Telegram e WhatsApp reenviam a mensagem quando a resposta demora (a IA
// pode levar uns segundos): sem isso o mesmo gasto entrava duas vezes.
const inboundCol = db.collection("inboundMessages");
const INBOUND_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export async function claimInboundMessage(channel: "telegram" | "whatsapp", messageId: string): Promise<boolean> {
  try {
    await inboundCol.doc(`${channel}_${messageId}`.replace(/\//g, "_")).create({ receivedAt: Date.now() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}

// Job diário: as marcas só precisam durar o tempo de um reenvio.
export async function pruneInboundMessages(now = Date.now()): Promise<number> {
  const snapshot = await inboundCol.where("receivedAt", "<", now - INBOUND_KEEP_MS).limit(400).get();
  if (snapshot.empty) return 0;
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
  return snapshot.size;
}

export async function saveLink(chatId: string, userId: string, groupId: string) {
  await linksCol.doc(chatId).set({ userId, groupId, linkedAt: Date.now() });
}

export async function findLinkByChatId(chatId: string): Promise<TelegramLink | null> {
  const doc = await linksCol.doc(chatId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { chatId, userId: data.userId, groupId: data.groupId };
}

export async function saveWhatsappLink(waId: string, userId: string, groupId: string) {
  await whatsappLinksCol.doc(waId).set({ userId, groupId, linkedAt: Date.now() });
}

export async function findWhatsappLinkByWaId(waId: string): Promise<WhatsappLink | null> {
  const doc = await whatsappLinksCol.doc(waId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return { waId, userId: data.userId, groupId: data.groupId };
}
