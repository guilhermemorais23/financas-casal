// Par em linguagem de gente: frase curta no lugar dos parágrafos, e lista
// vazia que ensina o próximo passo.
import { describe, expect, it } from "vitest";
import { onApi } from "../test/fakeApi";
import { ME, PARTNER } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { ParPage } from "./ParPage";

function setup(rows: unknown[], balances: unknown[] = []) {
  onApi("GET", "/groups/me", {
    accounts: [{ id: "acc-joint", type: "joint", name: "Nossa Conta", balance: 0 }, { id: "acc-me", type: "personal", name: "Eu", balance: 0 }],
    members: [{ id: ME, displayName: "Eu" }, { id: PARTNER, displayName: "aisha" }],
  });
  onApi("GET", /^\/transactions\/summary\?month=/, { byPayer: [], byCategory: [] });
  onApi("GET", "/transactions/balance", { balances });
  onApi("GET", /^\/budgets\/current/, { budget: null, spent: 0 });
  onApi("GET", /^\/transactions\?limit=50&accountId=acc-joint/, rows);
}

describe("Par: textos novos", () => {
  it("Quem ainda te deve, com uma linha só de explicação", async () => {
    setup([], [{ fromUserId: PARTNER, toUserId: ME, amount: 35 }]);
    const screen = await renderPage(<ParPage />);
    await expect.element(screen.getByText("Quem ainda te deve")).toBeVisible();
    await expect.element(screen.getByText("Marque como pago quando acertarem.")).toBeVisible();
    await expect.element(screen.getByText("aisha te deve")).toBeVisible();
    expect(screen.getByText("Divisões em aberto").query()).toBeNull();
    expect(screen.getByText(/não é só deste mês/).query()).toBeNull();
  });

  it("tudo acertado: avisa em uma frase", async () => {
    setup([]);
    const screen = await renderPage(<ParPage />);
    await expect.element(screen.getByText("Tudo acertado. Ninguém deve nada.")).toBeVisible();
  });

  it("sem gastos: ensina a lançar o primeiro", async () => {
    setup([]);
    const screen = await renderPage(<ParPage />);
    await expect.element(screen.getByText(/Lancem o primeiro gasto juntos/)).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Lançar um gasto" })).toHaveAttribute("href", "/transactions/new");
  });

  it("categoria com emoji aparece colorida; sem categoria, ícone neutro", async () => {
    const base = {
      amount: "10.00", transactionType: "expense", occurredAt: "2026-11-03", payerId: ME, accountId: "acc-joint",
      accountType: "joint", paymentMethod: null, splitType: "none", isSettled: false,
    };
    setup([
      { ...base, id: "t1", description: "Pizza", categoryId: "cat-food", categoryName: "Comida", categoryEmoji: "🍕" },
      { ...base, id: "t2", description: "Sei lá", categoryId: null, categoryName: null, categoryEmoji: null },
    ]);
    const screen = await renderPage(<ParPage />);
    await expect.element(screen.getByText("Pizza")).toBeVisible();
    const icons = document.querySelectorAll(".transaction-list .cat-icon");
    expect(icons[0].textContent).toBe("🍕");
    expect(getComputedStyle(icons[0]).backgroundColor).not.toBe(getComputedStyle(icons[1]).backgroundColor);
    expect(icons[1].classList.contains("is-none")).toBe(true);
  });
});
