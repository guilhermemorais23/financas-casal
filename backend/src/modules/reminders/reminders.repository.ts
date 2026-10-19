import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { findUserDocsInGroup } from "../users/users.repository";

const reminderLogsCol = db.collection("reminderLogs");
const groupsCol = db.collection("groups");

export interface MemberWithEmail {
  id: string;
  displayName: string;
  email: string | null;
}

export interface GroupIdRow {
  id: string;
}

export async function findAllGroupIds(): Promise<GroupIdRow[]> {
  // Só o id é necessário pra fazer o laço por grupo abaixo -- o select() evita
  // trazer o documento inteiro de cada grupo à toa.
  const snapshot = await groupsCol.select().get();
  return snapshot.docs.map((doc) => ({ id: doc.id }));
}

// Diferente do findMembersByGroupId do groups.repository, o job de lembretes
// precisa de um endereço pra mandar de verdade.
export async function findMembersWithEmailByGroupId(groupId: string): Promise<MemberWithEmail[]> {
  const docs = await findUserDocsInGroup(groupId);
  return docs.map((doc) => {
    const data = doc.data();
    return { id: doc.id, displayName: data.displayName, email: data.email ?? null };
  });
}

// Este lembrete exato (a fatura de um cartão, o estouro do orçamento do mês
// de um grupo...) já foi enviado? Quem chama monta a chave sempre do mesmo
// jeito, então o mesmo evento nunca vira dois e-mails, mesmo que o cron rode
// mais de uma vez.
export async function wasReminderSent(key: string): Promise<boolean> {
  const doc = await reminderLogsCol.doc(key).get();
  return doc.exists;
}

export async function markReminderSent(key: string, meta: Record<string, unknown>): Promise<void> {
  await reminderLogsCol.doc(key).set({ ...meta, sentAt: FieldValue.serverTimestamp() });
}

// Um documento por dia: create() dá erro se ele já existe, então só uma
// chamada roda os jobs daquele dia.
export async function claimDailyRun(day: string): Promise<void> {
  await db.collection("dailyJobRuns").doc(day).create({ startedAt: FieldValue.serverTimestamp() });
}
