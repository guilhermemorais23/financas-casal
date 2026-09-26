import { createHash } from "node:crypto";
import webpush from "web-push";
import { db } from "../../db/firestore";
import { logError } from "../../utils/errorLog";

// Notificação no celular (Web Push): o app instalado ou aberto no navegador
// pede permissão, o navegador dá um "endereço" (subscription) e o servidor
// manda os avisos pra ele com as chaves VAPID. Uma pessoa pode ter vários
// aparelhos. No iPhone, só funciona com o app adicionado à Tela de Início.
const col = db.collection("pushSubscriptions");
const MAX_PER_USER = 10;

export class InvalidSubscriptionError extends Error {}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim());
}

export function pushPublicKey(): string | null {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY!.trim() : null;
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!vapidReady) {
    const subject = process.env.VAPID_SUBJECT?.trim() || `mailto:${(process.env.ADMIN_EMAILS ?? "contato@par.app").split(",")[0].trim()}`;
    webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY!.trim(), process.env.VAPID_PRIVATE_KEY!.trim());
    vapidReady = true;
  }
  return true;
}

export interface PushSubscriptionInput {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

const idFor = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 40);

function validate(input: PushSubscriptionInput) {
  const endpoint = typeof input?.endpoint === "string" ? input.endpoint : "";
  const p256dh = typeof input?.keys?.p256dh === "string" ? input.keys.p256dh : "";
  const auth = typeof input?.keys?.auth === "string" ? input.keys.auth : "";
  let url: URL | null = null;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  // Só endereços https de verdade (os serviços de push dos navegadores).
  if (!url || url.protocol !== "https:" || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    throw new InvalidSubscriptionError();
  }
  return { endpoint, keys: { p256dh, auth } };
}

export async function saveSubscription(userId: string, input: PushSubscriptionInput, userAgent: string | undefined): Promise<void> {
  const sub = validate(input);
  const mine = await col.where("userId", "==", userId).get();
  // Aparelho demais: sai o mais antigo.
  const others = mine.docs.filter((doc) => doc.id !== idFor(sub.endpoint)).sort((a, b) => (a.get("createdAt") ?? 0) - (b.get("createdAt") ?? 0));
  for (const doc of others.slice(0, Math.max(0, others.length - (MAX_PER_USER - 1)))) await doc.ref.delete();
  await col.doc(idFor(sub.endpoint)).set({ userId, ...sub, userAgent: (userAgent ?? "").slice(0, 200), createdAt: Date.now() });
}

export async function removeSubscription(userId: string, endpoint: unknown): Promise<void> {
  if (typeof endpoint !== "string" || !endpoint) return;
  const ref = col.doc(idFor(endpoint));
  const doc = await ref.get();
  if (doc.exists && doc.get("userId") === userId) await ref.delete();
}

export async function countSubscriptions(userId: string): Promise<number> {
  return (await col.where("userId", "==", userId).count().get()).data().count;
}

export interface PushMessage {
  title: string;
  body: string;
  // Tela do app que abre ao tocar.
  url?: string;
  // Avisos com a mesma tag se substituem (não empilham).
  tag?: string;
}

// Manda pra todos os aparelhos da pessoa. Endereço que o navegador jogou fora
// (404/410) é apagado. Nunca lança: aviso é cortesia.
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!ensureVapid()) return 0;
  let delivered = 0;
  try {
    const subs = await col.where("userId", "==", userId).get();
    const payload = JSON.stringify({
      title: message.title.slice(0, 120),
      body: message.body.slice(0, 300),
      url: message.url && message.url.startsWith("/") ? message.url : "/dashboard",
      tag: message.tag,
    });
    await Promise.all(
      subs.docs.map(async (doc) => {
        const sub = doc.data() as { endpoint: string; keys: { p256dh: string; auth: string } };
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 24 * 60 * 60 });
          delivered++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await doc.ref.delete().catch(() => {});
          else logError("push", err, { userId });
        }
      })
    );
  } catch (err) {
    logError("push", err, { userId });
  }
  return delivered;
}

// Texto do email -> texto curto da notificação.
export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|h\d|li|div)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
