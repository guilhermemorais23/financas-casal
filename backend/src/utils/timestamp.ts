// Datas guardadas de dois jeitos no Firestore: número (Date.now()) ou
// Timestamp (serverTimestamp). Devolve milissegundos, ou null.
export function toMillis(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") return (value as { toMillis: () => number }).toMillis();
  return null;
}
