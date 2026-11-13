// Com a Planilha ligada: a subcategoria aparece como "Casa › Hipoteca" e o
// lançamento leva as marcações. Desligada, nada disso aparece.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { fakeAuth, members } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { MODULE_KEYS, type Preferences } from "../utils/preferences";
import { NewTransactionPage } from "./NewTransactionPage";

function setup() {
  onApi("GET", "/groups/me", {
    accounts: [{ id: "acc-me", type: "personal", name: "Eu", emoji: null, ownerUserId: "user-me" }],
    members: members.slice(0, 1),
  });
  onApi("GET", "/categories", [
    { id: "cat-casa", name: "Casa", emoji: null, type: "expense" },
    { id: "cat-hipoteca", name: "Hipoteca", emoji: null, type: "expense", parentId: "cat-casa" },
    { id: "cat-lazer", name: "Lazer", emoji: null, type: "expense" },
  ]);
  onApi("GET", "/cards", []);
  onApi("GET", /^\/categories\/suggest\?/, { categoryId: null, source: null });
  onApi("POST", "/transactions", (call) => ({ id: "tx-new", ...(call.body as object) }));
}

const allOn = (): Preferences => ({
  usage: "solo",
  goals: [],
  modules: Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as Preferences["modules"],
});

describe("lançar com a Planilha ligada", () => {
  it("subcategoria logo depois da de cima e as marcações vão junto", async () => {
    setup();
    fakeAuth.user.preferences = allOn();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    const category = screen.getByRole("combobox", { name: /Categoria/ });
    await expect.element(category.getByRole("option", { name: "Casa › Hipoteca" })).toBeInTheDocument();
    await screen.getByLabelText("Valor (R$)").fill("87,40");
    await screen.getByLabelText("Com o quê").fill("Remédio da pressão");
    await screen.getByLabelText("Marcações").fill("#Remédio, mãe");
    await screen.getByRole("button", { name: "Salvar despesa" }).click();
    await expect.poll(() => callsTo("POST", "/transactions").length).toBe(1);
    expect(callsTo("POST", "/transactions")[0].body).toMatchObject({ description: "Remédio da pressão", tags: ["remédio", "mãe"] });
  });

  it("sem a Planilha não tem campo de marcações nem manda tags", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    await screen.getByLabelText("Valor (R$)").fill("10");
    await screen.getByLabelText("Com o quê").fill("Café");
    expect(screen.getByLabelText("Marcações").query()).toBeNull();
    await screen.getByRole("button", { name: "Salvar despesa" }).click();
    await expect.poll(() => callsTo("POST", "/transactions").length).toBe(1);
    expect(callsTo("POST", "/transactions")[0].body).not.toHaveProperty("tags");
  });
});
