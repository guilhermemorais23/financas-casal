// Lista de compras: o campo de digitar não pode ficar espremido pelo botão
// (o .btn global tem width: 100% e esmagava o campo).
import { beforeEach, describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { members } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { ShoppingListPage } from "./ShoppingListPage";

beforeEach(() => {
  onApi("GET", "/shopping", []);
  onApi("GET", "/groups/me", { accounts: [], members });
  onApi("GET", "/categories", []);
});

describe("lista de compras", () => {
  for (const width of [320, 390, 1280]) {
    it(`o campo do item ocupa a maior parte da linha (${width}px)`, async () => {
      const screen = await renderPage(<ShoppingListPage />, { width });
      const input = screen.getByRole("textbox", { name: "Item pra comprar" });
      await expect.element(input).toBeVisible();
      const button = screen.getByRole("button", { name: "+ Item" }).element();
      const inputWidth = input.element().getBoundingClientRect().width;
      expect(inputWidth).toBeGreaterThan(button.getBoundingClientRect().width);
      expect(inputWidth).toBeGreaterThan(150);
    });
  }

  it("adicionar um item manda o nome pra API", async () => {
    onApi("POST", "/shopping", { id: "i1", name: "Leite", isChecked: false });
    const screen = await renderPage(<ShoppingListPage />);
    await screen.getByRole("textbox", { name: "Item pra comprar" }).fill("Leite");
    await screen.getByRole("button", { name: "+ Item" }).click();
    await expect.poll(() => callsTo("POST", "/shopping").length).toBe(1);
    expect(callsTo("POST", "/shopping")[0].body).toMatchObject({ name: "Leite" });
  });

  it("marcar comprado com valor \"1.234,56\" lança R$ 1.234,56 (ponto de milhar)", async () => {
    onApi("GET", "/shopping", [{ id: "i1", name: "Geladeira", isChecked: false, checkedBy: null }]);
    onApi("GET", "/groups/me", {
      accounts: [{ id: "acc1", name: "Conta conjunta", type: "joint", ownerUserId: null }],
      members,
    });
    onApi("PATCH", "/shopping/i1/check", { ok: true });
    const screen = await renderPage(<ShoppingListPage />);
    await screen.getByRole("checkbox").click();
    await screen.getByLabelText("Quanto custou (R$)").fill("1.234,56");
    await screen.getByRole("button", { name: "Confirmar compra" }).click();
    await expect.poll(() => callsTo("PATCH", "/shopping/i1/check").length).toBe(1);
    expect(callsTo("PATCH", "/shopping/i1/check")[0].body).toMatchObject({ amount: 1234.56 });
  });
});
