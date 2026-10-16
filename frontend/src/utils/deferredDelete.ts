// "Excluir" com Desfazer de verdade: a linha some da tela na hora, mas o
// pedido de DELETE só é enviado depois que o tempo de desfazer passou.
// Desfazer dentro desse tempo só cancela o timer -- nada foi apagado no
// servidor, então não há o que recriar (um lançamento recriado perderia o
// id, o status da divisão, a ligação da recorrência etc.).
//
// O estado fica no nível do módulo, e não dentro de um componente, de
// propósito: sair da tela durante o tempo de desfazer não pode perder o
// apagar pendente (o aviso, que fica na raiz do app, continua na tela e
// continua oferecendo Desfazer). Fechar a aba manda o que ainda estiver
// pendente.
const pending = new Map<string, { timer: number; run: () => Promise<void> }>();

export const UNDO_WINDOW_MS = 6000;

export function scheduleDeferred(key: string, run: () => Promise<void>, ms: number = UNDO_WINDOW_MS): void {
  cancelDeferred(key);
  const timer = window.setTimeout(() => {
    pending.delete(key);
    void run();
  }, ms);
  pending.set(key, { timer, run });
}

// true quando o apagar pendente ainda podia ser cancelado (ou seja, desfazer
// funcionou).
export function cancelDeferred(key: string): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  window.clearTimeout(entry.timer);
  pending.delete(key);
  return true;
}

// Uma lista buscada de novo durante o tempo de desfazer ainda tem a linha (o
// servidor ainda não apagou) -- as telas filtram estas, pra ela não voltar a
// aparecer.
export function isDeferredPending(key: string): boolean {
  return pending.has(key);
}

export function flushDeferred(): void {
  for (const [key, entry] of Array.from(pending.entries())) {
    window.clearTimeout(entry.timer);
    pending.delete(key);
    void entry.run();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushDeferred);
}
