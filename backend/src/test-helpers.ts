// Funções que montam os dados dos testes -- o mesmo padrão de "criar direto
// no Firestore, pulando HTTP e login" que o projeto sempre usou nos scripts
// de conferência avulsos, só que guardado de vez e rodando pelo vitest em vez
// de um .mjs descartável.
import { db } from "./db/firestore";
import { addUserToGroup, createAccount, createGroup } from "./modules/groups/groups.repository";

const usersCol = db.collection("users");

export interface TestGroup {
  groupId: string;
  userAId: string;
  userBId: string;
  personalAccountId: string;
  jointAccountId: string;
}

// Grupo de duas pessoas com uma conta pessoal (do "A") e uma conta conjunta --
// o formato de que quase todo teste do projeto precisa.
export async function createTestGroup(): Promise<TestGroup> {
  const group = await createGroup();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userAId = `test-a-${suffix}`;
  const userBId = `test-b-${suffix}`;

  await usersCol.doc(userAId).set({ email: `a-${suffix}@test.com`, displayName: "A", groupId: group.id });
  await usersCol.doc(userBId).set({ email: `b-${suffix}@test.com`, displayName: "B", groupId: group.id });
  await addUserToGroup({ id: userAId, groupIds: [] }, group.id);
  await addUserToGroup({ id: userBId, groupIds: [] }, group.id);

  const personalAccount = await createAccount({
    groupId: group.id,
    ownerUserId: userAId,
    type: "personal",
    name: "Pessoal A",
  });
  const jointAccount = await createAccount({ groupId: group.id, ownerUserId: null, type: "joint", name: "Conjunta" });

  return {
    groupId: group.id,
    userAId,
    userBId,
    personalAccountId: personalAccount.id,
    jointAccountId: jointAccount.id,
  };
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
