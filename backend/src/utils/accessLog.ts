import { db } from "../db/firestore";

const accessLogsCol = db.collection("accessLogs");

export type AccessEvent = "login" | "register";

export interface AccessLogEntry {
  id: string;
  event: AccessEvent;
  userId: string;
  email: string;
  createdAt: number;
}

// Só o suficiente pra responder "quem entrou e quando" -- sem token, sem
// senha, sem IP nem navegador. Dispara e esquece, igual o logError: nunca
// pode atrasar nem fazer falhar o login que está registrando.
export function logAccess(event: AccessEvent, user: { userId: string; email: string }): void {
  const entry = {
    event,
    userId: user.userId,
    email: user.email,
    createdAt: Date.now(),
  };
  accessLogsCol.add(entry).catch(() => {});
}

export async function listRecentAccess(limit: number): Promise<AccessLogEntry[]> {
  const snapshot = await accessLogsCol.orderBy("createdAt", "desc").limit(limit).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AccessLogEntry, "id">) }));
}
