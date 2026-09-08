// Shared fixture builders for tests -- same "fabricate directly in
// Firestore, bypass HTTP/auth" pattern this project has used in every
// scratch verification script all along, just kept around permanently and
// run through vitest instead of a throwaway .mjs file.
import { db } from "./db/firestore";
import { createAccount, createGroup, setUserGroup } from "./modules/groups/groups.repository";

const usersCol = db.collection("users");

export interface TestGroup {
  groupId: string;
  userAId: string;
  userBId: string;
  personalAccountId: string;
  jointAccountId: string;
}

// Two-person group with one personal account (owned by "A") and one joint
// account -- covers the shape almost every test in this project needs.
export async function createTestGroup(): Promise<TestGroup> {
  const group = await createGroup();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userAId = `test-a-${suffix}`;
  const userBId = `test-b-${suffix}`;

  await usersCol.doc(userAId).set({ email: `a-${suffix}@test.com`, displayName: "A", groupId: group.id });
  await usersCol.doc(userBId).set({ email: `b-${suffix}@test.com`, displayName: "B", groupId: group.id });
  await setUserGroup(userAId, group.id);
  await setUserGroup(userBId, group.id);

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
