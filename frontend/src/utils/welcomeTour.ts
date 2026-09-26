// A apresentação de boas-vindas aparece uma vez só, pra conta recém-criada.
// Quem decide é o servidor (welcomePending no perfil): o app avisa que ela
// apareceu assim que abre, então atualizar a página ou entrar por outro
// aparelho não mostra de novo. O que tiver de novo depois disso vai pelo
// Admin > Novidades (AnnouncementPopup).
//
// A marca local só cobre o intervalo até o perfil novo chegar do servidor
// (o perfil em cache ainda diz welcomePending). localStorage pode dar erro
// (modo privado) -- aí vale só o servidor.
const shownKey = (userId: string) => `par:welcome-shown:${userId}`;

export function isWelcomeTourPending(user: { id: string; welcomePending?: boolean }): boolean {
  if (user.welcomePending !== true) return false;
  try {
    return localStorage.getItem(shownKey(user.id)) !== "1";
  } catch {
    return true;
  }
}

export function markWelcomeTourShown(userId: string): void {
  try {
    localStorage.setItem(shownKey(userId), "1");
  } catch {
    // ignore
  }
}

// Enquanto a apresentação está na tela, os pop-ups de novidade esperam.
let openFor: string | null = null;
const listeners = new Set<() => void>();

export function setWelcomeTourOpen(userId: string | null): void {
  openFor = userId;
  listeners.forEach((listener) => listener());
}

export function isWelcomeTourOpen(userId: string): boolean {
  return openFor === userId;
}

export function subscribeWelcomeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
