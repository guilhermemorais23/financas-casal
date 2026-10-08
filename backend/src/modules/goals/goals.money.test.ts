// Metas com submetas, guardar tirando da conta, retirar, histórico, e o
// "Guardei" da importação.
import { describe, expect, it } from "vitest";
import { db } from "../../db/firestore";
import { createTestGroup, todayISO } from "../../test-helpers";
import { commitStatement } from "../statements/statements.service";
import { getAccountBalances, getMonthlySummary } from "../transactions/transactions.repository";
import {
  NotEnoughInGoalError,
  addGoalItem,
  createGoal,
  listContributions,
  moveGoalMoney,
  removeGoal,
  removeGoalItem,
} from "./goals.service";

const pcGamer = {
  name: "PC gamer",
  emoji: null,
  photoDataUrl: null,
  targetAmount: 0,
  deadline: null,
  items: [
    { name: "Placa de vídeo", targetAmount: 3200 },
    { name: "Placa-mãe", targetAmount: 900 },
    { name: "Processador", targetAmount: 1400 },
  ],
};

async function balanceOf(groupId: string, accountId: string): Promise<number> {
  return ((await getAccountBalances(groupId)).find((row) => row.accountId === accountId)?.balanceCents ?? 0) / 100;
}

describe("metas com submetas", () => {
  it("o alvo é a soma das submetas", async () => {
    const { userAId } = await createTestGroup();
    const goal = await createGoal(userAId, pcGamer);
    expect(goal.targetAmount).toBe("5500.00");
    expect(goal.items.map((item) => item.name)).toEqual(["Placa de vídeo", "Placa-mãe", "Processador"]);
  });

  it("guardar tirando da conta: saldo cai, não conta como gasto, fica no histórico", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const goal = await createGoal(userAId, pcGamer);
    const placaMae = goal.items[1];

    const after = await moveGoalMoney(userAId, goal.id, { direction: "deposit", amount: 900, itemId: placaMae.id, accountId: personalAccountId });
    expect(after.currentAmount).toBe("900.00");
    expect(after.items[1]).toMatchObject({ currentAmount: "900.00", isDone: true });

    expect(await balanceOf(groupId, personalAccountId)).toBe(-900);
    const month = todayISO().slice(0, 7);
    const summary = await getMonthlySummary(groupId, userAId, `${month}-01`, `${month}-32`, "visible");
    expect(summary.total).toBe("0.00");

    const history = await listContributions(userAId, goal.id);
    expect(history[0]).toMatchObject({ amount: "900.00", itemName: "Placa-mãe", accountId: personalAccountId });

    // Retirar mais do que tem na submeta: não deixa.
    await expect(
      moveGoalMoney(userAId, goal.id, { direction: "withdraw", amount: 1000, itemId: placaMae.id, accountId: personalAccountId })
    ).rejects.toBeInstanceOf(NotEnoughInGoalError);

    const back = await moveGoalMoney(userAId, goal.id, { direction: "withdraw", amount: 400, itemId: placaMae.id, accountId: personalAccountId });
    expect(back.currentAmount).toBe("500.00");
    expect(await balanceOf(groupId, personalAccountId)).toBe(-500);

    // Excluir a meta devolve o que saiu da conta.
    await removeGoal(userAId, goal.id);
    expect(await balanceOf(groupId, personalAccountId)).toBe(0);
  });

  it("meta simples que ganha submeta guarda o que tinha em 'Geral'; tirar submeta não perde dinheiro", async () => {
    const { userAId } = await createTestGroup();
    const goal = await createGoal(userAId, { name: "Viagem", emoji: null, photoDataUrl: null, targetAmount: 3000, deadline: null });
    await moveGoalMoney(userAId, goal.id, { direction: "deposit", amount: 500 });

    const withItem = await addGoalItem(userAId, goal.id, { name: "Hotel", targetAmount: 1500 });
    expect(withItem.items.map((item) => [item.name, item.currentAmount])).toEqual([
      ["Geral", "500.00"],
      ["Hotel", "0.00"],
    ]);
    expect(withItem.targetAmount).toBe("4500.00");

    const removed = await removeGoalItem(userAId, goal.id, withItem.items[0].id);
    expect(removed.items).toHaveLength(1);
    expect(removed.items[0]).toMatchObject({ name: "Hotel", currentAmount: "500.00" });
    expect(removed.currentAmount).toBe("500.00");
  });
});

describe("Guardei / entre minhas contas na importação", () => {
  it("guardado na caixinha vai pra meta e o saldo bate com o banco", async () => {
    const { groupId, userAId, personalAccountId } = await createTestGroup();
    const caixinha = await createGoal(userAId, { name: "Caixinha", emoji: null, photoDataUrl: null, targetAmount: 1000, deadline: null });
    const today = todayISO();
    await commitStatement(userAId, personalAccountId, [
      { description: "Salário", amount: 2000, transactionType: "income", occurredAt: today, categoryId: null },
      { description: "Guardado caixinha", amount: 100, transactionType: "expense", occurredAt: today, categoryId: null, transfer: { kind: "goal", goalId: caixinha.id } },
      { description: "Pix pra minha conta do Inter", amount: 300, transactionType: "expense", occurredAt: today, categoryId: null, transfer: { kind: "accounts" } },
    ]);

    expect(await balanceOf(groupId, personalAccountId)).toBe(1600);
    const goalDoc = (await db.collection("goals").doc(caixinha.id).get()).data()!;
    expect(goalDoc.currentAmountCents).toBe(10000);
    const month = today.slice(0, 7);
    const summary = await getMonthlySummary(groupId, userAId, `${month}-01`, `${month}-32`, "visible");
    expect(summary.total).toBe("0.00");
  });
});
