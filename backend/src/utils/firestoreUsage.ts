import { db } from "../db/firestore";

// Conta quantos documentos este servidor leu e gravou no "dia do Firestore"
// (a cota grátis de 50 mil leituras / 20 mil gravações zera à meia-noite do
// horário do Pacífico, ~4h/5h em Brasília). É uma estimativa: começa do zero
// quando o servidor reinicia (deploy, Render dormindo) e não vê o que é feito
// pelo console do Firebase. Mostrado em Admin > Visão geral.
export const FREE_READS_PER_DAY = 50_000;
export const FREE_WRITES_PER_DAY = 20_000;

let dayKey = "";
let reads = 0;
let writes = 0;
let countingSince = Date.now();

function quotaDay(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
}

function roll(): void {
  const today = quotaDay();
  if (today !== dayKey) {
    if (dayKey) countingSince = Date.now();
    dayKey = today;
    reads = 0;
    writes = 0;
  }
}

function addReads(n: number): void {
  roll();
  reads += Math.max(1, n);
}

function addWrites(n: number): void {
  roll();
  writes += n;
}

let installed = false;
// Envolve os métodos do SDK que leem/gravam só pra contar -- não muda o que
// eles fazem nem o resultado.
export function installFirestoreUsageCounter(): void {
  if (installed) return;
  installed = true;
  roll();

  const queryProto = Object.getPrototypeOf(db.collection("_").where("_", "==", 0));
  const originalQueryGet = queryProto.get;
  queryProto.get = async function (this: unknown, ...args: unknown[]) {
    const snap = await originalQueryGet.apply(this, args);
    addReads(snap.size);
    return snap;
  };

  const firestoreProto = Object.getPrototypeOf(db);
  const originalGetAll = firestoreProto.getAll;
  firestoreProto.getAll = async function (this: unknown, ...args: unknown[]) {
    const docs = await originalGetAll.apply(this, args);
    addReads(docs.length);
    return docs;
  };

  const aggregateProto = Object.getPrototypeOf(db.collection("_").count());
  const originalAggregateGet = aggregateProto.get;
  aggregateProto.get = async function (this: unknown, ...args: unknown[]) {
    const result = await originalAggregateGet.apply(this, args);
    addReads(1);
    return result;
  };

  // Toda gravação (doc.set/update, batch, transação) passa por um WriteBatch.
  const batchProto = Object.getPrototypeOf(db.batch());
  for (const method of ["set", "update", "create", "delete"]) {
    const original = batchProto[method];
    batchProto[method] = function (this: unknown, ...args: unknown[]) {
      addWrites(1);
      return original.apply(this, args);
    };
  }
}

export function getFirestoreUsage() {
  roll();
  return {
    reads,
    writes,
    readLimit: FREE_READS_PER_DAY,
    writeLimit: FREE_WRITES_PER_DAY,
    countingSince,
    counterInstalled: installed,
  };
}
