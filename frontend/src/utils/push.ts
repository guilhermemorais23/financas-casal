import { apiRequest } from "../api/client";

// Notificação no celular (Web Push). No iPhone só existe com o app na Tela de
// Início (Safari > Compartilhar > Adicionar à Tela de Início).
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

function keyToBytes(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

// Este aparelho já recebe? (tem permissão e endereço guardado)
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export class PushError extends Error {}

export async function enablePush(token: string | null, publicKey: string): Promise<void> {
  if (!pushSupported()) throw new PushError("Este navegador não recebe notificações.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new PushError(
      permission === "denied"
        ? "As notificações estão bloqueadas pra este site. Libere nas configurações do navegador."
        : "Você não permitiu as notificações."
    );
  }
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
  if (!reg) throw new PushError("O app ainda está carregando. Tente de novo em alguns segundos.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) as BufferSource }));
  await apiRequest("/push/subscribe", { method: "POST", token, body: { subscription: sub.toJSON() } });
}

export async function disablePush(token: string | null): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await apiRequest("/push/unsubscribe", { method: "POST", token, body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}
