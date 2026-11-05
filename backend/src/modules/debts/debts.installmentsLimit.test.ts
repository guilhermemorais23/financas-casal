// Dívida com parcelas demais (o lote de gravação passava de 500 e falhava no
// meio, deixando a dívida sem parcelas) ou com parcelas de R$ 0,00.
import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { InvalidInstallmentsError, createDebt } from "./debts.service";

const base = { name: "Celular", description: null, scope: "personal" as const, startMonth: "2026-11", dueDay: 10, categoryId: null };

describe("parcelas da dívida", () => {
  it("recusa mais de 360 parcelas", async () => {
    const { userAId } = await createTestGroup();
    await expect(createDebt(userAId, { ...base, totalAmount: 5000, installmentsCount: 361 })).rejects.toBeInstanceOf(InvalidInstallmentsError);
  });

  it("recusa parcela de menos de 1 centavo", async () => {
    const { userAId } = await createTestGroup();
    await expect(createDebt(userAId, { ...base, totalAmount: 0.05, installmentsCount: 10 })).rejects.toBeInstanceOf(InvalidInstallmentsError);
  });

  it("aceita 360 parcelas", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, { ...base, totalAmount: 36000, installmentsCount: 360 });
    expect(debt.installmentsCount).toBe(360);
  });
});
