// Stale-while-revalidate cache for page data: pages hydrate instantly from the
// last-seen value (survives closing the app, via localStorage) while a fresh
// fetch runs in the background and overwrites it. Keys are caller-scoped
// (include the user id) so switching accounts never shows another user's data.
const memoryCache = new Map<string, unknown>();

function storageKey(key: string): string {
  return `par-cache:${key}`;
}

export function readCache<T>(key: string): T | null {
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

export function writeCache<T>(key: string, value: T): void {
  memoryCache.set(key, value);
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    // Storage full or unavailable -- cache is a nice-to-have, not required.
  }
}
