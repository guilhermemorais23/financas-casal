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

// Os últimos erros também ficam na memória do servidor: se o Firestore
// estiver fora (ex.: cota diária do plano grátis estourada), gravar o log
// nele falha também e o erro sumiria. A memória some quando o servidor
// reinicia (deploy, Render dormindo), mas cobre justamente a hora do problema.
const MEMORY_LIMIT = 100;
const memoryErrors: ErrorLogEntry[] = [];
let memorySeq = 0;

// Erro de cota do Firestore (código gRPC 8, RESOURCE_EXHAUSTED): o plano
// grátis permite 50 mil leituras e 20 mil gravações por dia e zera à meia-noite
// do horário do Pacífico (4h ou 5h em Brasília).
export function isQuotaError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  const message = err instanceof Error ? err.message : String(err);
  return code === 8 || code === "resource-exhausted" || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message);
}

export function listMemoryErrors(limit: number): ErrorLogEntry[] {
  return memoryErrors.slice(-limit).reverse();
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
  memoryErrors.push({ id: `mem-${++memorySeq}`, ...entry });
  if (memoryErrors.length > MEMORY_LIMIT) memoryErrors.shift();
  // Com a cota estourada, gravar no Firestore falharia do mesmo jeito.
  if (isQuotaError(err)) return;
  errorLogsCol.add(entry).catch(() => {});
}

export async function listRecentErrors(limit: number): Promise<ErrorLogEntry[]> {
  const snapshot = await errorLogsCol.orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ErrorLogEntry, "id">) }));
}
