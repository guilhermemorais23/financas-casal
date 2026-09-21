// In-memory memo for the expensive, history-sized Firestore reads (account
// balances, the "quem deve quem" ledger, month/range scans of transactions).
//
// Why it exists: the free Firestore plan allows 50k document reads/day, and a
// single Painel load was costing ~1.6k of them -- most of it re-scanning the
// same transactions on every page (sidebar, month switch, alerts...). Reads
// are billed per document returned, so re-reading unchanged data is pure waste.
//
// Correctness rule: every write to a transaction or split goes through
// transactions.repository.ts, which calls invalidateTransactionReads() AFTER
// the write commits -- that bumps a version and every cached entry from an
// older version is ignored. (After, not before: bumping first would let a read
// that lands mid-write cache pre-write data under the new version.) Entries
// also expire on their own so a change made outside the app (e.g. someone
// editing in the Firebase console) still shows up eventually.
//
// Assumes ONE backend process (Render's free tier runs a single instance). If
// this ever scales to several instances, replace it with a shared cache --
// an in-process one would serve stale data from the instances that didn't
// perform the write.
const MAX_AGE_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 400;

interface Entry {
  version: number;
  at: number;
  promise: Promise<unknown>;
}

let version = 0;
const entries = new Map<string, Entry>();

export function invalidateTransactionReads(): void {
  version++;
}

// Caches the promise itself, so concurrent identical calls (e.g. the Painel
// and its alerts both asking for the same month at the same time) share one
// read instead of both hitting Firestore.
export function memoizeReads<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.version === version && now - hit.at < MAX_AGE_MS) {
    return hit.promise as Promise<T>;
  }

  const promise = load();
  const entry: Entry = { version, at: now, promise };
  entries.set(key, entry);
  if (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
  // A failed read must never be served again.
  promise.catch(() => {
    if (entries.get(key) === entry) entries.delete(key);
  });
  return promise;
}

// Test hook.
export function clearReadCache(): void {
  entries.clear();
  version++;
}
