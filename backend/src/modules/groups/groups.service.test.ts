import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { db } from "../../db/firestore";
import { CannotRemoveSelfError, MemberNotFoundError, removeMemberForUser } from "./groups.service";

describe("removeMemberForUser", () => {
  it("rejects removing yourself", async () => {
    const { userAId } = await createTestGroup();
    await expect(removeMemberForUser(userAId, userAId)).rejects.toBeInstanceOf(CannotRemoveSelfError);
  });

  it("rejects removing someone outside the group", async () => {
    const { userAId } = await createTestGroup();
    await expect(removeMemberForUser(userAId, "not-a-member")).rejects.toBeInstanceOf(MemberNotFoundError);
  });

  it("clears the target member's groupId", async () => {
    const { userAId, userBId, groupId } = await createTestGroup();
    await removeMemberForUser(userAId, userBId);
    const doc = await db.collection("users").doc(userBId).get();
    expect(doc.data()?.groupId).toBeNull();
    expect((await db.collection("users").doc(userAId).get()).data()?.groupId).toBe(groupId);
  });
});
