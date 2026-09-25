// Recuperação silenciosa de "essa aba está rodando uma versão antiga" e de
// outros erros ao carregar, pra ninguém ver a tela "Algo deu errado...
// Recarregar" depois de um deploy. Como acontece: o service worker se atualiza
// sozinho (skipWaiting + cleanupOutdatedCaches) com uma aba antiga ainda
// aberta; a próxima rota lazy pede um chunk pelo nome antigo, o arquivo não
// existe mais e o rewrite de SPA do Firebase Hosting responde com o
// index.html -- o import falha.
//
// A recuperação vai subindo de nível, controlada no sessionStorage pra nunca
// entrar em loop:
//   1ª falha -> pede a versão nova ao service worker e recarrega
//   2ª falha (em até um minuto) -> remove o service worker + os caches e
//      recarrega com um parâmetro que fura o cache (evita um index.html velho)
//   depois disso -> desiste e deixa quem chamou mostrar a tela de erro.

const ATTEMPTS_KEY = "par:recovery-attempts";
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 2;
export const RELOAD_PARAM = "_r";

// As mensagens que os navegadores usam quando o chunk de uma rota lazy não
// carrega (Chrome/Edge, Safari, Firefox, o preload do próprio Vite).
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk|Unable to preload CSS|MIME type/i.test(
    message
  );
}

function recentAttempts(): number[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(ATTEMPTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((at): at is number => typeof at === "number" && Date.now() - at < WINDOW_MS);
  } catch {
    return [];
  }
}

// Sem sessionStorage não dá pra diferenciar o primeiro recarregamento de um
// loop -- então não recarrega sozinho.
function storageWorks(): boolean {
  try {
    sessionStorage.setItem("par:recovery-probe", "1");
    sessionStorage.removeItem("par:recovery-probe");
    return true;
  } catch {
    return false;
  }
}

export function canRecover(): boolean {
  return storageWorks() && recentAttempts().length < MAX_ATTEMPTS;
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function softReload(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) await withTimeout(registration.update(), 1500);
  } catch {
    // ignora -- recarrega mesmo assim
  }
  window.location.reload();
}

async function hardReload(): Promise<void> {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await withTimeout(Promise.all(registrations.map((r) => r.unregister())), 1500);
    if ("caches" in window) {
      const keys = await caches.keys();
      await withTimeout(Promise.all(keys.map((key) => caches.delete(key))), 1500);
    }
  } catch {
    // ignora -- recarrega mesmo assim
  }
  const url = new URL(window.location.href);
  url.searchParams.set(RELOAD_PARAM, String(Date.now()));
  window.location.replace(url.toString());
}

// Começa o próximo passo da recuperação. Devolve false quando acabaram as
// tentativas (quem chamou deve mostrar a tela de erro).
export function recoverApp(): boolean {
  if (!canRecover()) return false;
  const attempts = recentAttempts();
  try {
    sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify([...attempts, Date.now()]));
  } catch {
    return false;
  }
  void (attempts.length === 0 ? softReload() : hardReload());
  return true;
}

// Botão "Recarregar" manual: sempre o caminho completo.
export function forceFreshReload(): void {
  void hardReload();
}

// Envolve o import de uma rota lazy: se o chunk sumiu, recarrega na versão
// nova e mantém o skeleton do Suspense na tela em vez de cair na tela de
// erro.
export async function importWithRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isChunkLoadError(error) && recoverApp()) return new Promise<T>(() => {});
    throw error;
  }
}

// Chamar uma vez ao iniciar: esconde da barra de endereço o parâmetro que
// fura o cache e manda as falhas de preload do Vite pra mesma recuperação.
export function initAppRecovery(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(RELOAD_PARAM)) {
      url.searchParams.delete(RELOAD_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    // ignora
  }
  // O Vite dispara isso quando um <link rel=modulepreload> / CSS de um chunk
  // falha.
  window.addEventListener("vite:preloadError", (event) => {
    if (recoverApp()) event.preventDefault();
  });
}
