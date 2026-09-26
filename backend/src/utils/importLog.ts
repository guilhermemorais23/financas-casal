import { db } from "../db/firestore";

const importEventsCol = db.collection("importEvents");

// Como foi cada leitura de extrato, pro Admin ver por banco o que dá certo e
// o que falha. Só o resultado -- nada do conteúdo do extrato (nomes, valores).
export type ImportOutcome =
  | "ok" // leu e (quando tem saldo no PDF) bateu
  | "unreconciled" // leu, mas o saldo não bateu
  | "empty" // não achou nenhum lançamento
  | "password" // PDF com senha (faltando ou errada)
  | "error" // não conseguiu ler
  | "committed"; // a pessoa confirmou e importou

export interface ImportEvent {
  userId: string;
  source: string; // banco do PDF, "ofx", "csv" ou "openfinance"
  outcome: ImportOutcome;
  rows: number;
  readBy: "ai" | "text" | null;
  createdAt: number;
}

// Fire-and-forget: nunca atrasa nem derruba a importação que está contando.
export function logImport(event: Omit<ImportEvent, "createdAt">): void {
  importEventsCol.add({ ...event, createdAt: Date.now() }).catch(() => {});
}

export interface ImportSourceStats {
  source: string;
  attempts: number;
  ok: number;
  unreconciled: number;
  empty: number;
  password: number;
  error: number;
  byAi: number;
}

export interface ImportStats {
  days: number;
  sources: ImportSourceStats[];
  committed: number;
  committedRows: number;
  people: number;
}

export async function getImportStats(days = 30, now = Date.now()): Promise<ImportStats> {
  const since = now - days * 24 * 60 * 60 * 1000;
  const snapshot = await importEventsCol.where("createdAt", ">=", since).get();
  const bySource = new Map<string, ImportSourceStats>();
  const people = new Set<string>();
  let committed = 0;
  let committedRows = 0;
  for (const doc of snapshot.docs) {
    const e = doc.data() as ImportEvent;
    people.add(e.userId);
    if (e.outcome === "committed") {
      committed++;
      committedRows += e.rows ?? 0;
      continue;
    }
    const s =
      bySource.get(e.source) ??
      { source: e.source, attempts: 0, ok: 0, unreconciled: 0, empty: 0, password: 0, error: 0, byAi: 0 };
    s.attempts++;
    s[e.outcome]++;
    if (e.readBy === "ai") s.byAi++;
    bySource.set(e.source, s);
  }
  const sources = [...bySource.values()].sort((a, b) => b.attempts - a.attempts);
  return { days, sources, committed, committedRows, people: people.size };
}
