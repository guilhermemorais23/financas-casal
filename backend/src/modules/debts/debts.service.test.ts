import { describe, expect, it } from "vitest";
import { createTestGroup } from "../../test-helpers";
import { createDebt, listDebts, setInstallmentPaidForUser, updateDebtForUser } from "./debts.service";
import { findTransactionById } from "../transactions/transactions.repository";
import { addMonths, todayInBrazil } from "../../utils/month";
import { insertCategory } from "../categories/categories.repository";
import { InvalidCategoryError } from "../transactions/transactions.service";

function currentMonthParam(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("createDebt + dueDay", () => {
  it("attaches a computed dueDate to each installment when dueDay is set", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Financiamento",
      description: null,
      totalAmount: 200,
      installmentsCount: 2,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: 10,
    });

    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.dueDay).toBe(10);
    expect(found.installments[0].dueDate).toMatch(/-10$/);
  });

  it("leaves dueDate null when no dueDay was set", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Sem vencimento",
      description: null,
      totalAmount: 100,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: null,
    });

    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.installments[0].dueDate).toBeNull();
  });
});

describe("setInstallmentPaidForUser", () => {
  it("books a real expense when marking paid, and removes it when unmarking", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Cartão",
      description: null,
      totalAmount: 300,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: null,
    });
    const [withInstallments] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    const installment = withInstallments.installments[0];

    const paid = await setInstallmentPaidForUser(userAId, debt.id, installment.id, true);
    expect(paid.isPaid).toBe(true);
    expect(paid.transactionId).toBeTruthy();
    expect((await findTransactionById(paid.transactionId!))?.transactionType).toBe("expense");

    const unpaid = await setInstallmentPaidForUser(userAId, debt.id, installment.id, false);
    expect(unpaid.isPaid).toBe(false);
    expect(unpaid.transactionId).toBeNull();
  });

  it("conta só esta vez: atrasada paga hoje entra com a data de hoje e o nome da conta", async () => {
    const { userAId } = await createTestGroup();
    const debt = await createDebt(userAId, {
      name: "Academia",
      description: null,
      totalAmount: 129.9,
      installmentsCount: 1,
      scope: "personal",
      startMonth: addMonths(currentMonthParam(), -1),
      dueDay: 20,
    });
    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);

    const paid = await setInstallmentPaidForUser(userAId, debt.id, found.installments[0].id, true);
    const tx = await findTransactionById(paid.transactionId!);
    expect(tx?.occurredAt).toBe(todayInBrazil());
    expect(tx?.description).toBe("Academia");
  });

  it("parcelada continua no mês da parcela, com 'parcela N/M'", async () => {
    const { userAId } = await createTestGroup();
    const start = addMonths(currentMonthParam(), -1);
    const debt = await createDebt(userAId, {
      name: "Geladeira",
      description: null,
      totalAmount: 200,
      installmentsCount: 2,
      scope: "personal",
      startMonth: start,
      dueDay: 10,
    });
    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    const first = found.installments.find((i) => i.installmentNumber === 1)!;

    const paid = await setInstallmentPaidForUser(userAId, debt.id, first.id, true);
    const tx = await findTransactionById(paid.transactionId!);
    expect(tx?.occurredAt).toBe(`${start}-01`);
    expect(tx?.description).toBe("Geladeira — parcela 1/2");
  });

  it("conta só esta vez com categoria: o gasto pago sai com essa categoria", async () => {
    const { groupId, userAId } = await createTestGroup();
    const category = await insertCategory({ groupId, name: "Academia", emoji: null });
    const debt = await createDebt(userAId, {
      name: "Mensalidade atrasada",
      description: null,
      totalAmount: 129.9,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: 10,
      categoryId: category.id,
    });
    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.categoryId).toBe(category.id);

    const paid = await setInstallmentPaidForUser(userAId, debt.id, found.installments[0].id, true);
    expect((await findTransactionById(paid.transactionId!))?.categoryId).toBe(category.id);
  });

  it("recusa categoria de outro grupo", async () => {
    const outro = await createTestGroup();
    const alheia = await insertCategory({ groupId: outro.groupId, name: "De outro grupo", emoji: null });
    const { userAId } = await createTestGroup();
    await expect(
      createDebt(userAId, {
        name: "Teste",
        description: null,
        totalAmount: 10,
        installmentsCount: 1,
        scope: "personal",
        startMonth: currentMonthParam(),
        dueDay: 10,
        categoryId: alheia.id,
      })
    ).rejects.toBeInstanceOf(InvalidCategoryError);
  });

  it("trocar a categoria depois de criar: o gasto pago sai com a nova", async () => {
    const { groupId, userAId } = await createTestGroup();
    const antiga = await insertCategory({ groupId, name: "Lazer", emoji: null });
    const nova = await insertCategory({ groupId, name: "Saúde", emoji: null });
    const debt = await createDebt(userAId, {
      name: "Academia",
      description: null,
      totalAmount: 129.9,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: 10,
      categoryId: antiga.id,
    });

    await updateDebtForUser(userAId, debt.id, { name: "Academia", description: null, categoryId: nova.id });
    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.categoryId).toBe(nova.id);

    const paid = await setInstallmentPaidForUser(userAId, debt.id, found.installments[0].id, true);
    expect((await findTransactionById(paid.transactionId!))?.categoryId).toBe(nova.id);
  });

  it("editar sem mandar categoria mantém a que estava; trocar por de outro grupo é recusado", async () => {
    const outro = await createTestGroup();
    const alheia = await insertCategory({ groupId: outro.groupId, name: "De outro grupo", emoji: null });
    const { groupId, userAId } = await createTestGroup();
    const minha = await insertCategory({ groupId, name: "Saúde", emoji: null });
    const debt = await createDebt(userAId, {
      name: "Exame",
      description: null,
      totalAmount: 80,
      installmentsCount: 1,
      scope: "personal",
      startMonth: currentMonthParam(),
      dueDay: 10,
      categoryId: minha.id,
    });

    await updateDebtForUser(userAId, debt.id, { name: "Exame de sangue", description: null });
    const [found] = (await listDebts(userAId)).filter((d) => d.id === debt.id);
    expect(found.categoryId).toBe(minha.id);

    await expect(
      updateDebtForUser(userAId, debt.id, { name: "Exame", description: null, categoryId: alheia.id })
    ).rejects.toBeInstanceOf(InvalidCategoryError);
  });
});
