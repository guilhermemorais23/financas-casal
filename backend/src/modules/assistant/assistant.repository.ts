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
  const doc = await linkCodesCol.doc(code).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  await linkCodesCol.doc(code).delete();
  if (data.expiresAt < Date.now()) return null;
  return { userId: data.userId, groupId: data.groupId };
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
