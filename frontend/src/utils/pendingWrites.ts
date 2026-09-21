// Writes that were shown on screen before the server confirmed them
// (optimistic updates). A page that fetches fresh data right after such a
// write would otherwise race it -- the GET can land before the POST
// commits, and the "real" (stale) answer would erase what was just shown.
// Pages call whenWritesSettled() before their revalidation fetch, so the
// fetch always runs after the in-flight writes finished.
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

// Fired when an optimistic write failed and the screens that showed it
// should re-fetch the truth (see useDataChangedListener users).
export const DATA_CHANGED_EVENT = "par:data-changed";

export function notifyDataChanged(): void {
  window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}
