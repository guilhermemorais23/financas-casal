// Gravações que apareceram na tela antes de o servidor confirmar
// (atualizações otimistas). Uma tela que busca dados novos logo depois de uma
// gravação dessas apostaria corrida com ela -- o GET pode chegar antes de o
// POST confirmar, e a resposta "de verdade" (velha) apagaria o que acabou de
// aparecer. As telas chamam whenWritesSettled() antes da busca de
// conferência, então a busca sempre roda depois que as gravações a caminho
// terminaram.
const inFlight = new Set<Promise<unknown>>();

export function trackWrite<T>(promise: Promise<T>): Promise<T> {
  inFlight.add(promise);
  const done = () => {
    inFlight.delete(promise);
  };
  promise.then(done, done);
  return promise;
}

export async function whenWritesSettled(): Promise<void> {
  if (inFlight.size === 0) return;
  await Promise.allSettled(Array.from(inFlight));
}

// Disparado quando uma gravação otimista falhou e as telas que a mostraram
// devem buscar a verdade de novo (ver quem usa o useDataChangedListener).
export const DATA_CHANGED_EVENT = "par:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}
