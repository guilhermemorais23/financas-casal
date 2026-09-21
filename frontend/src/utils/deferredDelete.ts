// "Excluir" with a real Desfazer: the row disappears from the screen right
// away, but the DELETE request is only sent once the undo window has passed.
// Undoing inside that window just cancels the timer -- nothing was ever
// deleted on the server, so there's nothing to recreate (a recreated
// transaction would lose its id, split status, recurring link, etc).
//
// State lives at module level, not inside a component, on purpose: leaving
// the page during the undo window must not drop the pending delete (the
// toast, which lives at the app root, is still on screen and still offers
// Desfazer). Closing the tab flushes whatever is still pending.
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

// True when the pending delete was still cancellable (i.e. undo worked).
export function cancelDeferred(key: string): boolean {
  const entry = pending.get(key);
  if (!entry) return false;
  window.clearTimeout(entry.timer);
  pending.delete(key);
  return true;
}

// A list refetched during the undo window still contains the row (the
// server hasn't deleted it yet) -- pages filter these out so it doesn't
// pop back on screen.
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
