// Dívidas: "Paguei tudo de uma vez (com desconto)" e mudar o valor de uma
// parcela paga -- o caso do Nubank parcelado em 5 e quitado com desconto.
import { beforeEach, describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { renderPage } from "../test/render";
import { DebtsPage } from "./DebtsPage";

function installment(n: number, isPaid: boolean) {
  return { id: String(n), installmentNumber: n, amount: "57.80", isPaid, referenceMonth: `2026-${String(6 + n).padStart(2, "0")}`, dueDate: null };
}

const nubank = {
  id: "debt-nubank",
  scope: "personal",
  name: "Nubank",
  description: null,
  totalAmount: "289.00",
  installmentsCount: 5,
  startMonth: "2026-07",
  dueDay: null,
  categoryId: null,
  installments: [1, 2, 3, 4, 5].map((n) => installment(n, n <= 2)),
  paidAmount: 115.6,
  remainingAmount: 173.4,
  paidCount: 2,
  remainingCount: 3,
};

beforeEach(() => {
  onApi("GET", "/debts", [nubank]);
  onApi("GET", "/categories", []);
});

describe("quitar com desconto", () => {
  it("começa na primeira parcela em aberto e manda o valor pago de verdade", async () => {
    onApi("POST", "/debts/debt-nubank/payoff", null);
    const screen = await renderPage(<DebtsPage />);
    await screen.getByRole("button", { name: "Paguei tudo de uma vez (com desconto)" }).click();

    await expect.element(screen.getByLabelText("A partir da parcela")).toHaveValue("3");
    await expect.element(screen.getByText(/3 parcelas, R\$\s?173,40 sem desconto\./)).toBeVisible();

    await screen.getByLabelText("Quanto você pagou de verdade (R$)").fill("150,00");
    await screen.getByRole("button", { name: "Quitar" }).click();

    await expect.poll(() => callsTo("POST", "/debts/debt-nubank/payoff").length).toBe(1);
    expect(callsTo("POST", "/debts/debt-nubank/payoff")[0].body).toMatchObject({ fromInstallment: 3, amount: 150 });
  });

  it("a partir da parcela 1 avisa que as já pagas têm o lançamento trocado", async () => {
    const screen = await renderPage(<DebtsPage />);
    await screen.getByRole("button", { name: "Paguei tudo de uma vez (com desconto)" }).click();
    await screen.getByLabelText("A partir da parcela").selectOptions("1");
    await expect.element(screen.getByText(/2 já estavam marcadas como pagas: o lançamento delas é trocado/)).toBeVisible();
  });
});

describe("parcela paga", () => {
  it("dá pra mudar o valor (e só manda o que mudou)", async () => {
    onApi("PATCH", "/debts/debt-nubank/installments/1", {});
    const screen = await renderPage(<DebtsPage />);
    await screen.getByTitle(/Parcela 1 · .* clique pra editar/).click();

    await expect.element(screen.getByLabelText("Valor pago (R$)")).toHaveValue("57,80");
    await screen.getByLabelText("Valor pago (R$)").fill("50,00");
    await screen.getByRole("button", { name: "Salvar", exact: true }).click();

    await expect.poll(() => callsTo("PATCH", "/debts/debt-nubank/installments/1").length).toBe(1);
    expect(callsTo("PATCH", "/debts/debt-nubank/installments/1")[0].body).toEqual({ amount: 50 });
  });
});
