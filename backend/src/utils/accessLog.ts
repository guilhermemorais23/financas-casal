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

// Just enough to answer "quem entrou e quando" for oversight -- no token, no
// password, no IP/user-agent. Fire-and-forget, same as logError: this must
// never delay or fail the login it's recording.
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
