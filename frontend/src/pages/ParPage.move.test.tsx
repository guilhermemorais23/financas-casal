// Par: lançamento da Nossa Conta que na verdade é só seu (ex.: dinheiro
// guardado num cartão criado como "Do grupo") passa pra sua conta pessoal sem
// apagar. E o Excluir avisa que o lançamento some do Painel também -- é o
// mesmo lançamento nos dois lugares.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { ME, PARTNER } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { ParPage } from "./ParPage";

function row(id: string, description: string, extra: Record<string, unknown> = {}) {
  return {
    id, description, amount: "170.00", transactionType: "expense", occurredAt: "2026-11-03", payerId: ME,
    accountId: "acc-joint", accountType: "joint", paymentMethod: null, categoryId: null, categoryName: null,
    categoryEmoji: null, splitType: "none", isSettled: false, ...extra,
  };
}

function setup(rows: unknown[]) {
  onApi("GET", "/groups/me", {
    accounts: [{ id: "acc-joint", type: "joint", name: "Nossa Conta" }, { id: "acc-me", type: "personal", name: "Eu" }],
    members: [{ id: ME, displayName: "Eu" }, { id: PARTNER, displayName: "aisha" }],
  });
  onApi("GET", /^\/transactions\/summary\?month=/, { byPayer: [], byCategory: [] });
  onApi("GET", "/transactions/balance", { balances: [] });
  onApi("GET", /^\/budgets\/current/, { budget: null, spent: 0 });
  onApi("GET", /^\/transactions\?limit=50&accountId=acc-joint/, rows);
  onApi("PATCH", /^\/transactions\/[^/]+\/account$/, {});
}

describe("Par: passar pra minha conta", () => {
  it("guardado no cartão: passa pra minha conta (o cartão vira pessoal)", async () => {
    setup([row("tx-card", "Guardado no cartão Inter", { securedCardId: "card-1" })]);
    const screen = await renderPage(<ParPage />);
    await screen.getByRole("button", { name: "Passar pra minha conta" }).click();
    await expect.element(screen.getByText(/O cartão passa a ser só seu/)).toBeInTheDocument();
    await screen.getByRole("button", { name: "Passar pra minha conta" }).last().click();
    await expect.poll(() => callsTo("PATCH", "/transactions/tx-card/account").map((c) => c.body)).toEqual([{ to: "personal" }]);
  });

  it("gasto comum da Nossa Conta também passa", async () => {
    setup([row("tx-1", "Farmácia")]);
    const screen = await renderPage(<ParPage />);
    await screen.getByRole("button", { name: "Passar pra minha conta" }).click();
    await expect.element(screen.getByText(/sai da Nossa Conta e vai pra sua conta pessoal/)).toBeInTheDocument();
  });

  it("Excluir avisa que some do Painel também", async () => {
    setup([row("tx-1", "Farmácia")]);
    const screen = await renderPage(<ParPage />);
    await screen.getByRole("button", { name: "Excluir" }).click();
    await expect.element(screen.getByText(/some do Par e do Painel de todo mundo do grupo/)).toBeInTheDocument();
  });

  it("parcela de dívida não passa de conta (só pela tela de Dívidas)", async () => {
    setup([row("tx-1", "Parcela 1/3", { linkKind: "debt_installment" })]);
    const screen = await renderPage(<ParPage />);
    await expect.element(screen.getByText("Parcela 1/3")).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Passar pra minha conta" })).not.toBeInTheDocument();
  });
});
