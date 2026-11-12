// "Primeiros passos" do Painel: cada passo fica feito sozinho, olhando o grupo.
import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createSoloTestGroup, createTestGroup, todayISO } from "../../test-helpers";
import { setCurrentBudget } from "../budgets/budgets.service";
import { getDashboardForUser } from "../dashboard/dashboard.service";
import { createGoal } from "../goals/goals.service";
import { createTransaction } from "../transactions/transactions.service";
import { markChecklistDismissed, savePreferences } from "../users/users.repository";
import { defaultModules } from "../users/preferences";
import { getChecklistForUser } from "./checklist.service";

function stepsOf(checklist: Awaited<ReturnType<typeof getChecklistForUser>>) {
  return Object.fromEntries((checklist?.steps ?? []).map((step) => [step.id, step.done]));
}

function expense(userId: string, accountId: string, splitType: "none" | "equal" = "none", isPrivate = false) {
  return createTransaction(userId, {
    accountId,
    categoryId: null,
    payerId: userId,
    description: "Mercado",
    amount: 50,
    transactionType: "expense",
    occurredAt: todayISO(),
    isPrivate,
    splitType,
  });
}

describe("getChecklistForUser", () => {
  it("grupo de uma pessoa recém-criado: os 3 passos de casal, nada feito", async () => {
    const { userId } = await createSoloTestGroup();
    const checklist = await getChecklistForUser(userId);
    expect(checklist).toEqual({
      steps: [
        { id: "first_transaction", done: false },
        { id: "invite_partner", done: false },
        { id: "first_split", done: false },
      ],
      completedAt: null,
    });
  });

  it("lançar marca first_transaction; dividir igual marca first_split", async () => {
    const { userId, personalAccountId } = await createSoloTestGroup();
    await expense(userId, personalAccountId);
    expect(stepsOf(await getChecklistForUser(userId))).toEqual({
      first_transaction: true,
      invite_partner: false,
      first_split: false,
    });

    const group = await createTestGroup();
    await expense(group.userAId, group.jointAccountId, "equal");
    expect(stepsOf(await getChecklistForUser(group.userBId))).toEqual({
      first_transaction: true,
      invite_partner: true,
      first_split: true,
    });
  });

  it("lançamento privado do par na conta conjunta não conta pra mim", async () => {
    const { userAId, userBId, jointAccountId } = await createTestGroup();
    await expense(userAId, jointAccountId, "none", true);
    expect(stepsOf(await getChecklistForUser(userBId)).first_transaction).toBe(false);
    expect(stepsOf(await getChecklistForUser(userAId)).first_transaction).toBe(true);
  });

  it("quem usa sozinho vê lançar, orçamento e meta", async () => {
    const { userId, personalAccountId } = await createSoloTestGroup();
    await savePreferences(userId, { usage: "solo", goals: ["spending"], modules: defaultModules("solo", ["spending"]) });
    expect(stepsOf(await getChecklistForUser(userId))).toEqual({
      first_transaction: false,
      set_budget: false,
      first_goal: false,
    });

    await expense(userId, personalAccountId);
    await setCurrentBudget(userId, 2000);
    await createGoal(userId, { name: "Viagem", emoji: null, photoDataUrl: null, targetAmount: 5000, deadline: null });
    const checklist = await getChecklistForUser(userId);
    expect(stepsOf(checklist)).toEqual({ first_transaction: true, set_budget: true, first_goal: true });
    expect(checklist?.completedAt).toEqual(expect.any(String));
  });

  it("tudo feito grava completedAt uma vez; some 3 dias depois", async () => {
    const { userAId, jointAccountId } = await createTestGroup();
    await expense(userAId, jointAccountId, "equal");
    const doneAt = new Date("2026-03-10T12:00:00.000Z");
    const first = await getChecklistForUser(userAId, doneAt);
    expect(first?.completedAt).toBe(doneAt.toISOString());
    expect((await db.collection("users").doc(userAId).get()).data()?.checklistCompletedAt).toBe(doneAt.toISOString());

    // Ainda dentro dos 3 dias: mesma data de antes, não a de agora.
    const later = await getChecklistForUser(userAId, new Date("2026-03-12T12:00:00.000Z"));
    expect(later?.completedAt).toBe(doneAt.toISOString());

    expect(await getChecklistForUser(userAId, new Date("2026-03-13T12:00:01.000Z"))).toBeNull();
  });

  it("fechar faz o cartão sumir (também no Painel)", async () => {
    const { userAId } = await createTestGroup();
    const before = await getDashboardForUser(userAId);
    expect(before?.checklist?.steps).toHaveLength(3);

    await markChecklistDismissed(userAId);
    expect(await getChecklistForUser(userAId)).toBeNull();
    expect((await getDashboardForUser(userAId))?.checklist).toBeNull();
  });
});
