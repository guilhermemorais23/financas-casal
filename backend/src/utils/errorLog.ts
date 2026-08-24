import { db } from "../db/firestore";

const errorLogsCol = db.collection("errorLogs");

export interface ErrorLogEntry {
  id: string;
  source: string;
  message: string;
  stack: string | null;
  path: string | null;
  method: string | null;
  userId: string | null;
  createdAt: number;
}

// Fire-and-forget by design -- logging must never delay the response for
// the error that's already being handled, and a Firestore hiccup here
// shouldn't compound the original failure.
export function logError(
  source: string,
  err: unknown,
  extra?: { path?: string; method?: string; userId?: string }
): void {
  const entry = {
    source,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? (err.stack ?? null) : null,
    path: extra?.path ?? null,
    method: extra?.method ?? null,
    userId: extra?.userId ?? null,
    createdAt: Date.now(),
  };
  errorLogsCol.add(entry).catch(() => {});
}

export async function listRecentErrors(limit: number): Promise<ErrorLogEntry[]> {
  const snapshot = await errorLogsCol.orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ErrorLogEntry, "id">) }));
}
