import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  // Grupo aberto quando o app não diz qual (o último em que a pessoa entrou).
  // Sempre está em groupIds, ou é null quando groupIds está vazio.
  groupId: string | null;
  // Todos os grupos da pessoa (casal, família...).
  groupIds: string[];
  photoDataUrl: string | null;
  phone: string | null;
  // Apresentação de boas-vindas: true só pra conta criada agora, até ela
  // aparecer uma vez. Contas antigas (sem o campo) contam como já vista.
  welcomePending: boolean;
}

const usersCol = db.collection("users");

// Perfis de antes dos vários grupos só têm groupId -- vale como lista de um.
export function groupIdsOf(data: FirebaseFirestore.DocumentData): string[] {
  const ids: string[] = Array.isArray(data.groupIds) ? data.groupIds.filter((id: unknown) => typeof id === "string") : [];
  if (typeof data.groupId === "string" && !ids.includes(data.groupId)) ids.unshift(data.groupId);
  return ids;
}

function toUserRow(id: string, data: FirebaseFirestore.DocumentData): UserRow {
  return {
    id,
    email: data.email,
    displayName: data.displayName,
    groupId: data.groupId ?? null,
    groupIds: groupIdsOf(data),
    photoDataUrl: data.photoDataUrl ?? null,
    phone: data.phone ?? null,
    welcomePending: data.welcomePending === true,
  };
}

export function findUserById(userId: string): Promise<UserRow | null> {
  return memoizeScoped(`user:${userId}`, [`user:${userId}`], async () => {
    const doc = await usersCol.doc(userId).get();
    if (!doc.exists) return null;
    return toUserRow(doc.id, doc.data()!);
  });
}

// Pode chamar várias vezes: roda em todo login, não só no primeiro cadastro,
// então o documento de perfil sempre existe quando qualquer outra rota
// precisa. O isNew diz a quem chamou se foi o primeiríssimo login (ex.: pra
// mandar o e-mail de boas-vindas uma vez só, e não a cada login).
export async function upsertUserProfile(input: {
  id: string;
  email: string;
  displayName: string;
}): Promise<{ user: UserRow; isNew: boolean }> {
  const ref = usersCol.doc(input.id);
  const existing = await ref.get();
  if (existing.exists) {
    return { user: toUserRow(existing.id, existing.data()!), isNew: false };
  }

  await ref.set({
    email: input.email,
    displayName: input.displayName,
    groupId: null,
    groupIds: [],
    photoDataUrl: null,
    phone: null,
    welcomePending: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return {
    user: {
      id: input.id,
      email: input.email,
      displayName: input.displayName,
      groupId: null,
      groupIds: [],
      photoDataUrl: null,
      phone: null,
      welcomePending: true,
    },
    isNew: true,
  };
}

export async function updateUserProfile(
  userId: string,
  updates: { displayName?: string; photoDataUrl?: string | null; phone?: string | null; email?: string }
): Promise<UserRow> {
  const ref = usersCol.doc(userId);
  await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  const doc = await ref.get();
  return toUserRow(doc.id, doc.data()!);
}

export async function markWelcomeSeen(userId: string): Promise<void> {
  await usersCol.doc(userId).update({ welcomePending: false, welcomeSeenAt: FieldValue.serverTimestamp() });
}

// Quem está no grupo: perfis novos têm o grupo em groupIds; os de antes dos
// vários grupos só em groupId. As duas consultas juntas pegam todo mundo.
export async function findUserDocsInGroup(groupId: string): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const [byList, byLegacy] = await Promise.all([
    usersCol.where("groupIds", "array-contains", groupId).get(),
    usersCol.where("groupId", "==", groupId).get(),
  ]);
  const seen = new Set<string>();
  return [...byList.docs, ...byLegacy.docs].filter((doc) => {
    if (seen.has(doc.id)) return false;
    seen.add(doc.id);
    return true;
  });
}
