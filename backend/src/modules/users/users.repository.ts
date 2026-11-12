import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";
import { preferencesFromStored, type Preferences } from "./preferences";

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
  // Uso e módulos ligados (ver preferences.ts). null = ainda não respondeu.
  preferences: Preferences | null;
  // "Primeiros passos" do Painel: fechado de vez pela pessoa, e quando todos
  // os passos ficaram feitos pela primeira vez (some 3 dias depois).
  checklistDismissed: boolean;
  checklistCompletedAt: string | null;
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
    preferences: preferencesFromStored(data.preferences),
    checklistDismissed: data.checklistDismissed === true,
    checklistCompletedAt: typeof data.checklistCompletedAt === "string" ? data.checklistCompletedAt : null,
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
      preferences: null,
      checklistDismissed: false,
      checklistCompletedAt: null,
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

export async function savePreferences(userId: string, preferences: Preferences): Promise<void> {
  await usersCol.doc(userId).set({ preferences, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

// Liga/desliga módulos lendo e gravando juntos: dois toques rápidos em
// módulos diferentes não apagam um ao outro. Sem preferências ainda, parte
// do padrão de quem não respondeu (tudo ligado).
export async function updatePreferenceModules(
  userId: string,
  patch: Partial<Preferences["modules"]>,
  fallback: Preferences
): Promise<Preferences> {
  const ref = usersCol.doc(userId);
  return db.runTransaction(async (tx) => {
    const current = preferencesFromStored((await tx.get(ref)).data()?.preferences) ?? fallback;
    const next: Preferences = { ...current, modules: { ...current.modules, ...patch } };
    tx.set(ref, { preferences: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
}

export async function markChecklistDismissed(userId: string): Promise<void> {
  await usersCol.doc(userId).set({ checklistDismissed: true }, { merge: true });
}

// Só a primeira vez conta: é dela que saem os 3 dias até o cartão sumir.
export async function saveChecklistCompletedAt(userId: string, completedAt: string): Promise<string> {
  const ref = usersCol.doc(userId);
  return db.runTransaction(async (tx) => {
    const saved = (await tx.get(ref)).data()?.checklistCompletedAt;
    if (typeof saved === "string") return saved;
    tx.set(ref, { checklistCompletedAt: completedAt }, { merge: true });
    return completedAt;
  });
}

// Fechamento do mês: o último mês em que a pessoa tocou "Entendi". Guarda só
// o mais novo -- marcar um mês antigo não faz um mais novo voltar.
export async function findMonthCloseSeen(userId: string): Promise<string | null> {
  const doc = await usersCol.doc(userId).get();
  const seen = doc.data()?.monthCloseSeen;
  return typeof seen === "string" ? seen : null;
}

export async function saveMonthCloseSeen(userId: string, month: string): Promise<void> {
  const ref = usersCol.doc(userId);
  await db.runTransaction(async (tx) => {
    const seen = (await tx.get(ref)).data()?.monthCloseSeen;
    if (typeof seen === "string" && seen >= month) return;
    tx.set(ref, { monthCloseSeen: month }, { merge: true });
  });
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
