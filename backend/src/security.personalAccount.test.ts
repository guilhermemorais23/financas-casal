// Lançamento da conta pessoal de alguém só quem criou mexe (a mesma regra de
// canManageTransaction) -- também quando ele nasceu de um item da lista de
// compras ou de uma contribuição de meta, que qualquer membro do grupo vê.
import { describe, expect, it } from "vitest";
import { db } from "./db/firestore";
import { createTestGroup } from "./test-helpers";
import { createGoal, listContributions, moveGoalMoney, updateContribution } from "./modules/goals/goals.service";
import { addItem, checkItem, removeItem, uncheckItem } from "./modules/shopping/shopping.service";
import { PartnerPersonalEntryError } from "./utils/errors";

async function transactionCount(groupId: string): Promise<number> {
  return (await db.collection("transactions").where("groupId", "==", groupId).get()).size;
}

describe("lista de compras paga pela conta pessoal", () => {
  it("o parceiro não desmarca nem apaga o item (o gasto de quem pagou ficaria sumido)", async () => {
    const { groupId, userAId, userBId, personalAccountId } = await createTestGroup();
    const item = await addItem(userAId, "Remédio");
    await checkItem(userAId, item.id, { accountId: personalAccountId, categoryId: null, amount: 80 });

    await expect(uncheckItem(userBId, item.id)).rejects.toBeInstanceOf(PartnerPersonalEntryError);
    await expect(removeItem(userBId, item.id)).rejects.toBeInstanceOf(PartnerPersonalEntryError);
    expect(await transactionCount(groupId)).toBe(1);

    await uncheckItem(userAId, item.id);
    expect(await transactionCount(groupId)).toBe(0);
  });

  it("item pago pela conta conjunta qualquer um desmarca", async () => {
    const { groupId, userAId, userBId, jointAccountId } = await createTestGroup();
    const item = await addItem(userAId, "Arroz");
    await checkItem(userAId, item.id, { accountId: jointAccountId, categoryId: null, amount: 30 });

    await uncheckItem(userBId, item.id);
    expect(await transactionCount(groupId)).toBe(0);
  });
});

describe("contribuição de meta tirada da conta pessoal", () => {
  it("o parceiro não corrige nem apaga", async () => {
    const { userAId, userBId, personalAccountId } = await createTestGroup();
    const goal = await createGoal(userAId, { name: "Viagem", emoji: null, photoDataUrl: null, targetAmount: 5000, deadline: null });
    await moveGoalMoney(userAId, goal.id, { direction: "deposit", amount: 300, accountId: personalAccountId });
    const [contribution] = await listContributions(userAId, goal.id);

    await expect(updateContribution(userBId, goal.id, contribution.id, 100)).rejects.toBeInstanceOf(PartnerPersonalEntryError);
    await expect(updateContribution(userBId, goal.id, contribution.id, null)).rejects.toBeInstanceOf(PartnerPersonalEntryError);

    const [after] = await listContributions(userAId, goal.id);
    expect(after.amount).toBe("300.00");
    await updateContribution(userAId, goal.id, contribution.id, 250);
    expect((await listContributions(userAId, goal.id))[0].amount).toBe("250.00");
  });
});
