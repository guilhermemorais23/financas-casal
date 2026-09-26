import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { findUserById, markWelcomeSeen, upsertUserProfile } from "./users.repository";

describe("apresentação de boas-vindas", () => {
  it("shows once for a brand-new account and never again after it opened", async () => {
    const id = `welcome-${Date.now()}`;
    const { user, isNew } = await upsertUserProfile({ id, email: `${id}@par.dev`, displayName: "Nova" });
    expect(isNew).toBe(true);
    expect(user.welcomePending).toBe(true);
    expect((await findUserById(id))?.welcomePending).toBe(true);

    await markWelcomeSeen(id);

    expect((await findUserById(id))?.welcomePending).toBe(false);
    // Entrar de novo (outro aparelho) não reabre.
    const again = await upsertUserProfile({ id, email: `${id}@par.dev`, displayName: "Nova" });
    expect(again.user.welcomePending).toBe(false);
  });

  it("treats accounts created before the flag existed as already welcomed", async () => {
    const id = `old-${Date.now()}`;
    await db.collection("users").doc(id).set({ email: `${id}@par.dev`, displayName: "Antiga", groupId: null });
    expect((await findUserById(id))?.welcomePending).toBe(false);
  });
});
