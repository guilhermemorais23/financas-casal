// Stale-while-revalidate cache for page data: pages hydrate instantly from the
// last-seen value (survives closing the app, via localStorage) while a fresh
// fetch runs in the background and overwrites it. Keys are caller-scoped
// (include the user id) so switching accounts never shows another user's data.
// Aqui cada chave ganha também o grupo aberto: trocar de grupo nunca mostra
// os números do outro grupo.
import { getActiveGroupId } from "../api/activeGroup";

const memoryCache = new Map<string, unknown>();

// Cached responses are whatever shape the API had when they were written --
// a deploy that adds/renames a field left every already-cached month in
// someone's browser missing it, and pages read the cache first (see
// DashboardPage.load), so switching to a stale cached month crashed the page
// ("Algo deu errado... Recarregar"). Tying the cache to the app version
// throws all of it away on the first load after any release, so a cached
// entry is only ever read by the same bundle that wrote it.
const CACHE_VERSION_KEY = "par-cache-version";
export function clearCache(): void {
  memoryCache.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("par-cache:")) localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable -- nothing persisted to clear.
  }
}
try {
  if (localStorage.getItem(CACHE_VERSION_KEY) !== __APP_VERSION__) {
    clearCache();
    localStorage.setItem(CACHE_VERSION_KEY, __APP_VERSION__);
  }
} catch {
  // Storage unavailable: cache is best-effort anyway.
}

function scopedKey(key: string): string {
  return `${getActiveGroupId() ?? "-"}:${key}`;
}

function storageKey(key: string): string {
  return `par-cache:${key}`;
}

export function readCache<T>(rawKey: string): T | null {
  const key = scopedKey(rawKey);
  if (memoryCache.has(key)) return memoryCache.get(key) as T;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const value = JSON.parse(raw) as T;
    memoryCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

export function writeCache<T>(rawKey: string, value: T): void {
  const key = scopedKey(rawKey);
  memoryCache.set(key, value);
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Storage full or unavailable -- cache is a nice-to-have, not required.
  }
}
