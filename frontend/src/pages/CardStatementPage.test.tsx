// Fatura do cartão: faturas separadas por mês e editar compra (à vista e
// parcelada).
import { beforeEach, describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { ME, members } from "../test/fakeAuth";
import { isInside, renderPage } from "../test/render";
import { CardStatementPage } from "./CardStatementPage";

const CARD = { id: "card-1", name: "Nubank", closingDay: 9, limit: null, limitUsed: null, currentStatement: { month: "2026-11" } };

function purchase(over: Record<string, unknown>) {
  return {
    id: "p1",
    description: "doce penaforte",
    amount: "12.00",
    categoryId: "cat-food",
    buyerId: ME,
    purchaseDate: "2026-11-03",
    installmentNumber: 1,
    installmentsCount: 1,
    ...over,
  };
}

beforeEach(() => {
  onApi("GET", "/cards", [CARD]);
  onApi("GET", "/categories", [{ id: "cat-food", name: "Alimentação", type: "expense" }]);
  onApi("GET", "/groups/me", { members });
  onApi("GET", "/cards/card-1/statements", [
    { month: "2026-12", dueDate: "2026-12-15", total: "57.80", isPaid: false },
    { month: "2026-11", dueDate: "2026-11-15", total: "69.79", isPaid: false },
    { month: "2026-10", dueDate: "2026-10-15", total: "300.00", isPaid: true },
  ]);
  onApi("GET", /^\/cards\/card-1\/statement\?month=/, (call) => ({
    month: new URLSearchParams(call.path.split("?")[1]).get("month"),
    dueDate: "2026-11-15",
    total: "69.79",
    isPaid: false,
    purchases: [
      purchase({}),
      purchase({ id: "p2", description: "Geladeira", amount: "57.79", installmentNumber: 2, installmentsCount: 5, purchaseDate: "2026-09-20" }),
    ],
  }));
});

function openStatement(width = 390) {
  return renderPage(<CardStatementPage />, { route: "/cards/card-1/fatura", path: "/cards/:id/fatura", width });
}

describe("faturas por mês", () => {
  it("mostra uma fatura por mês, com total e status, e troca de mês ao tocar", async () => {
    const screen = await openStatement();
    const strip = screen.getByRole("navigation", { name: "Faturas por mês" });
    await expect.element(strip).toBeVisible();
    await expect.element(strip.getByRole("button", { name: /nov\/26.*R\$\s?69,79.*Atual/ })).toHaveAttribute("aria-current", "true");
    await expect.element(strip.getByRole("button", { name: /out\/26.*Paga/ })).toBeVisible();
    await expect.element(strip.getByRole("button", { name: /dez\/26.*Futura/ })).toBeVisible();

    await strip.getByRole("button", { name: /out\/26/ }).click();
    await expect.poll(() => callsTo("GET", /statement\?month=2026-10/).length).toBe(1);
  });

  it("no celular a faixa rola de lado em vez de vazar da tela", async () => {
    const screen = await openStatement(320);
    await expect.element(screen.getByRole("navigation", { name: "Faturas por mês" })).toBeVisible();
    const strip = screen.getByRole("navigation", { name: "Faturas por mês" }).element();
    expect(strip.getBoundingClientRect().right).toBeLessThanOrEqual(320);
    expect(getComputedStyle(strip).overflowX).toBe("auto");
  });
});

describe("editar compra", () => {
  it("compra à vista: abre preenchida e salva nome, valor e data", async () => {
    onApi("PATCH", "/cards/card-1/purchases/p1", {});
    const screen = await openStatement();
    await screen.getByRole("button", { name: "Editar doce penaforte" }).click();

    await expect.element(screen.getByRole("heading", { name: "Editar compra" })).toBeVisible();
    await expect.element(screen.getByLabelText("O que foi")).toHaveValue("doce penaforte");
    await expect.element(screen.getByLabelText("Valor (R$)")).toHaveValue("12,00");
    await expect.element(screen.getByLabelText("Data da compra")).toBeEnabled();

    await screen.getByLabelText("O que foi").fill("Doce Penaforte");
    await screen.getByLabelText("Valor (R$)").fill("15,50");
    await screen.getByRole("button", { name: "Salvar alterações" }).click();

    await expect.poll(() => callsTo("PATCH", "/cards/card-1/purchases/p1").length).toBe(1);
    expect(callsTo("PATCH", "/cards/card-1/purchases/p1")[0].body).toEqual({
      description: "Doce Penaforte",
      amount: 15.5,
      categoryId: "cat-food",
      buyerId: ME,
      purchaseDate: "2026-11-03",
    });
  });

  it("compra parcelada: avisa o que muda em todas as parcelas, trava a data e o valor é só desta parcela", async () => {
    const screen = await openStatement();
    await screen.getByRole("button", { name: "Editar Geladeira" }).click();

    await expect.element(screen.getByText(/Parcela 2\/5\. Nome, categoria e quem comprou mudam em todas as parcelas/)).toBeVisible();
    await expect.element(screen.getByLabelText("Valor desta parcela (R$)")).toHaveValue("57,79");
    await expect.element(screen.getByLabelText("Data da compra")).toBeDisabled();
    await expect.element(screen.getByLabelText("Parcelas")).not.toBeInTheDocument();
  });

  it("os botões de editar e excluir ficam dentro da linha no celular", async () => {
    const screen = await openStatement(320);
    const edit = screen.getByRole("button", { name: "Editar doce penaforte" });
    await expect.element(edit).toBeVisible();
    const row = edit.element().closest(".fatura-row")!;
    expect(isInside(edit.element(), row)).toBe(true);
    expect(isInside(screen.getByRole("button", { name: "Remover doce penaforte" }).element(), row)).toBe(true);
  });
});
