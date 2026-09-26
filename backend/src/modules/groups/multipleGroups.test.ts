import { describe, expect, it } from "vitest";
import { createTestGroup, todayISO } from "../../test-helpers";
import { db } from "../../db/firestore";
import { runWithActiveGroup } from "../../utils/activeGroup";
import { createTransaction, listTransactions } from "../transactions/transactions.service";
import { findMembersByGroupId } from "./groups.repository";
import {
  AlreadyInGroupError,
  GroupAccessError,
  MAX_GROUPS_PER_USER,
  TooManyGroupsError,
  acceptInvite,
  createGroupForUser,
  createNewInvite,
  leaveGroup,
  listGroupsForUser,
  requireGroupId,
} from "./groups.service";

// A (você) está no grupo do casal com B (namorada) e cria um segundo grupo
// (família) onde entra C. B e C nunca podem ver o grupo um do outro.
async function twoGroups() {
  const couple = await createTestGroup();
  const { userAId, userBId } = couple;
  const { group: family } = await createGroupForUser(userAId, { name: "Casa da família", emoji: "🏠" });
  const userCId = `test-c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.collection("users").doc(userCId).set({ email: `${userCId}@test.com`, displayName: "C", groupId: null });
  const token = await runWithActiveGroup(family.id, () => createNewInvite(userAId));
  await acceptInvite(userCId, token);
  return { coupleId: couple.groupId, familyId: family.id, userAId, userBId, userCId, jointAccountId: couple.jointAccountId };
}

describe("vários grupos", () => {
  it("deixa entrar em outro grupo sem sair do primeiro", async () => {
    const { coupleId, familyId, userAId } = await twoGroups();
    const user = (await db.collection("users").doc(userAId).get()).data()!;
    expect(user.groupIds).toEqual([coupleId, familyId]);

    const { groups } = await listGroupsForUser(userAId);
    expect(groups.map((g) => g.id)).toEqual([coupleId, familyId]);
    expect(groups[1]).toMatchObject({ nickname: "Casa da família", emoji: "🏠", memberCount: 2 });
  });

  it("usa o grupo pedido pelo app e recusa grupo de que a pessoa não é membro", async () => {
    const { coupleId, familyId, userAId, userBId, userCId } = await twoGroups();
    expect(await runWithActiveGroup(coupleId, () => requireGroupId(userAId))).toBe(coupleId);
    expect(await runWithActiveGroup(familyId, () => requireGroupId(userAId))).toBe(familyId);
    await expect(runWithActiveGroup(familyId, () => requireGroupId(userBId))).rejects.toBeInstanceOf(GroupAccessError);
    await expect(runWithActiveGroup(coupleId, () => requireGroupId(userCId))).rejects.toBeInstanceOf(GroupAccessError);
  });

  it("não mostra as transações de um grupo no outro", async () => {
    const { coupleId, familyId, userAId, userCId, jointAccountId } = await twoGroups();
    await runWithActiveGroup(coupleId, () =>
      createTransaction(userAId, {
        accountId: jointAccountId,
        categoryId: null,
        payerId: userAId,
        description: "jantar do casal",
        amount: 120,
        transactionType: "expense",
        occurredAt: todayISO(),
        isPrivate: false,
        splitType: "none",
      })
    );

    const inCouple = await runWithActiveGroup(coupleId, () => listTransactions(userAId, 50));
    const inFamilyForA = await runWithActiveGroup(familyId, () => listTransactions(userAId, 50));
    const inFamilyForC = await runWithActiveGroup(familyId, () => listTransactions(userCId, 50));
    expect(inCouple.map((t) => t.description)).toContain("jantar do casal");
    expect(inFamilyForA).toHaveLength(0);
    expect(inFamilyForC).toHaveLength(0);
  });

  it("lista só os membros de cada grupo", async () => {
    const { coupleId, familyId, userAId, userBId, userCId } = await twoGroups();
    const couple = (await findMembersByGroupId(coupleId)).map((m) => m.id).sort();
    const family = (await findMembersByGroupId(familyId)).map((m) => m.id).sort();
    expect(couple).toEqual([userAId, userBId].sort());
    expect(family).toEqual([userAId, userCId].sort());
  });

  it("sair do grupo aberto mantém os outros", async () => {
    const { coupleId, familyId, userAId } = await twoGroups();
    await runWithActiveGroup(familyId, () => leaveGroup(userAId));
    const user = (await db.collection("users").doc(userAId).get()).data()!;
    expect(user.groupIds).toEqual([coupleId]);
    expect(user.groupId).toBe(coupleId);
  });

  it("recusa convite de um grupo em que a pessoa já está", async () => {
    const { familyId, userAId } = await twoGroups();
    const token = await runWithActiveGroup(familyId, () => createNewInvite(userAId));
    await expect(acceptInvite(userAId, token)).rejects.toBeInstanceOf(AlreadyInGroupError);
  });

  it(`limita a ${MAX_GROUPS_PER_USER} grupos por pessoa`, async () => {
    const { userAId } = await createTestGroup();
    for (let i = 1; i < MAX_GROUPS_PER_USER; i++) await createGroupForUser(userAId);
    await expect(createGroupForUser(userAId)).rejects.toBeInstanceOf(TooManyGroupsError);
  });
});
