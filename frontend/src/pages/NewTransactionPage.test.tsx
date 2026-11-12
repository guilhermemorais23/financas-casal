// Lançar em 3 toques: valor (com o cursor já nele), o que foi e salvar. A
// categoria vem sugerida pelo servidor sem atropelar a escolha da pessoa, e
// com mais gente no grupo dividir é um toque.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { members } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { NewTransactionPage } from "./NewTransactionPage";

const CATEGORIES = [
  { id: "cat-mercado", name: "Mercado", emoji: null, type: "expense" },
  { id: "cat-lazer", name: "Lazer", emoji: null, type: "expense" },
  { id: "cat-outros", name: "Outros", emoji: null, type: "expense" },
];

function setup({ alone = false, suggestion = "cat-mercado" as string | null } = {}) {
  onApi("GET", "/groups/me", {
    accounts: [{ id: "acc-me", type: "personal", name: "Eu", emoji: null, ownerUserId: "user-me" }],
    members: alone ? members.slice(0, 1) : members,
  });
  onApi("GET", "/categories", CATEGORIES);
  onApi("GET", "/cards", []);
  onApi("GET", /^\/categories\/suggest\?/, { categoryId: suggestion, source: suggestion ? "keyword" : null });
  onApi("POST", "/transactions", (call) => ({ id: "tx-new", ...(call.body as object) }));
}

describe("lançar", () => {
  it("abre com o cursor no valor", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    const amount = screen.getByLabelText("Valor (R$)");
    await expect.element(amount).toHaveFocus();
    await expect.element(amount).toHaveAttribute("inputmode", "decimal");
  });

  it("a descrição traz a categoria sugerida, com o selo", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    await screen.getByLabelText("Com o quê").fill("supermercado");
    await expect
      .poll(() => callsTo("GET", /^\/categories\/suggest\?/).map((c) => c.path))
      .toContain("/categories/suggest?description=supermercado&type=expense");
    await expect.element(screen.getByRole("combobox", { name: /Categoria/ })).toHaveValue("cat-mercado");
    await expect.element(screen.getByText("sugerida")).toBeVisible();
  });

  it("escolheu na mão: a sugestão não troca mais", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    const category = screen.getByRole("combobox", { name: /Categoria/ });
    await expect.element(category.getByRole("option", { name: "Lazer" })).toBeInTheDocument();
    await category.selectOptions("cat-lazer");
    await screen.getByLabelText("Com o quê").fill("supermercado");
    // Espera mais que o tempo da sugestão.
    await new Promise((resolve) => setTimeout(resolve, 600));
    await expect.element(category).toHaveValue("cat-lazer");
    expect(screen.getByText("sugerida").query()).toBeNull();
  });

  it("Dividir com o par manda a divisão igual", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    await screen.getByLabelText("Valor (R$)").fill("80");
    await screen.getByLabelText("Com o quê").fill("Pizza");
    const split = screen.getByRole("button", { name: "Dividir com aisha" });
    await split.click();
    await expect.element(split).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText(/R\$\s?40,00 pra cada um/)).toBeVisible();
    await screen.getByRole("button", { name: "Salvar despesa" }).click();

    await expect.poll(() => callsTo("POST", "/transactions").length).toBe(1);
    const body = callsTo("POST", "/transactions")[0].body as Record<string, unknown>;
    expect(body).toMatchObject({ description: "Pizza", amount: 80, splitType: "equal", transactionType: "expense" });
  });

  it("sem dividir, salva com splitType none; sozinho no grupo não tem o botão", async () => {
    setup({ alone: true });
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    await screen.getByLabelText("Valor (R$)").fill("12,50");
    await screen.getByLabelText("Com o quê").fill("Café");
    await expect.element(screen.getByRole("button", { name: /Dividir/ })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Salvar despesa" }).click();
    await expect.poll(() => callsTo("POST", "/transactions").length).toBe(1);
    expect(callsTo("POST", "/transactions")[0].body).toMatchObject({ amount: 12.5, splitType: "none" });
  });

  it("data, conta e forma de pagamento ficam em Mais opções", async () => {
    setup();
    const screen = await renderPage(<NewTransactionPage />, { route: "/transactions/new" });
    await expect.element(screen.getByLabelText("Data")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Pix" })).not.toBeInTheDocument();
    await screen.getByRole("button", { name: /Mais opções/ }).click();
    await expect.element(screen.getByLabelText("Data")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Pix" })).toBeVisible();
  });
});
