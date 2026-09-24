// Silent recovery from "this tab is running an old build" and other load
// crashes, so nobody sees the "Algo deu errado... Recarregar" screen after a
// deploy. How it happens: the service worker updates itself (skipWaiting +
// cleanupOutdatedCaches) while an old tab is still open; the next lazy route
// asks for a chunk under its old hashed name, the file no longer exists, and
// Firebase Hosting's SPA rewrite answers with index.html -- the import fails.
//
// Recovery escalates, tracked in sessionStorage so it can never loop:
//   1st failure -> ask the service worker for the new version, then reload
//   2nd failure (within a minute) -> drop the service worker + its caches and
//      reload with a cache-busting query (skips a stale HTTP-cached index.html)
//   after that -> give up and let the caller show a fallback screen.

const ATTEMPTS_KEY = "par:recovery-attempts";
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 2;
export const RELOAD_PARAM = "_r";

// The messages browsers use when a lazy route chunk can't be fetched
// (Chrome/Edge, Safari, Firefox, Vite's own preload helper).
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

// Without sessionStorage we can't tell a first reload from a loop -- don't
// auto-reload at all then.
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
    // ignore -- reload anyway
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
    // ignore -- reload anyway
  }
  const url = new URL(window.location.href);
  url.searchParams.set(RELOAD_PARAM, String(Date.now()));
  window.location.replace(url.toString());
}

// Starts the next recovery step. Returns false when recovery is exhausted
// (the caller should show its fallback instead).
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

// Manual "Recarregar" button: always the thorough path.
export function forceFreshReload(): void {
  void hardReload();
}

// Wraps a lazy route import: if the chunk is gone, reload into the new build
// and keep the Suspense skeleton up meanwhile instead of throwing into the
// error screen.
export async function importWithRecovery<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isChunkLoadError(error) && recoverApp()) return new Promise<T>(() => {});
    throw error;
  }
}

// Call once at startup: hides the cache-busting query from the address bar
// and routes Vite's preload failures into the same recovery.
export function initAppRecovery(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has(RELOAD_PARAM)) {
      url.searchParams.delete(RELOAD_PARAM);
      window.history.replaceState(window.history.state, "", url.toString());
    }
  } catch {
    // ignore
  }
  // Vite fires this when a <link rel=modulepreload> / CSS of a chunk fails.
  window.addEventListener("vite:preloadError", (event) => {
    if (recoverApp()) event.preventDefault();
  });
}
