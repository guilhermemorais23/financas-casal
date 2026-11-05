// Painel: lançamento na conta errada passa entre a sua conta e a Nossa Conta
// sem apagar e lançar de novo.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { ME, PARTNER } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { DashboardPage } from "./DashboardPage";

function row(id: string, description: string, accountType: "personal" | "joint", extra: Record<string, unknown> = {}) {
  return {
    id, description, amount: "40.00", transactionType: "expense", occurredAt: "2026-11-03", categoryId: null,
    categoryName: null, categoryEmoji: null, recurringGroupId: null, splitType: "none", isSettled: false,
    accountId: accountType === "joint" ? "acc-joint" : "acc-me", accountType, paymentMethod: null, payerId: ME, ...extra,
  };
}

function setup(recent: unknown[]) {
  const totals = { income: 0, expense: 0 };
  onApi("GET", /^\/dashboard\?month=/, {
    group: {
      accounts: [
        { id: "acc-joint", type: "joint", name: "Nossa Conta", balance: 0 },
        { id: "acc-me", type: "personal", name: "Eu", balance: 0 },
      ],
      members: [{ id: ME, displayName: "Eu" }, { id: PARTNER, displayName: "aisha" }],
    },
    recent, debts: [], summary: { total: "0", byCategory: [] }, jointSummary: { byPayer: [] }, balance: { balances: [] },
    budget: { budget: null, spent: 0 }, categoryBudgets: [], dailyTrend: [], personalMonthTotals: totals,
    personalPrevMonthTotals: totals, goalHighlight: null, nextInvoice: null, trend6m: [], alerts: [],
  });
  onApi("GET", /^\/transactions\?limit=1/, [{}]);
  onApi("GET", "/open-finance/pending", { total: 0, banks: [] });
  onApi("GET", /^\/transactions\/uncategorized/, { count: 0 });
  onApi("GET", /^\/month-close/, { hasActivity: false });
  onApi("PATCH", /^\/transactions\/[^/]+\/account$/, {});
}

describe("Painel: passar entre contas", () => {
  it("lançamento pessoal: Passar pro grupo", async () => {
    setup([row("tx-1", "Mercado", "personal")]);
    const screen = await renderPage(<DashboardPage />);
    await screen.getByRole("button", { name: "Mais ações" }).click();
    await screen.getByRole("menuitem", { name: "Passar pro grupo" }).click();
    await screen.getByRole("button", { name: "Passar pro grupo" }).click();
    await expect.poll(() => callsTo("PATCH", "/transactions/tx-1/account").map((c) => c.body)).toEqual([{ to: "joint" }]);
  });

  it("guardado num cartão do grupo: só tem Passar pra minha conta", async () => {
    setup([row("tx-2", "Guardado no cartão Inter", "joint", { securedCardId: "card-1" })]);
    const screen = await renderPage(<DashboardPage />);
    await screen.getByRole("button", { name: "Mais ações" }).click();
    await expect.element(screen.getByRole("menuitem", { name: "Passar pra minha conta" })).toBeInTheDocument();
    await expect.element(screen.getByRole("menuitem", { name: "Excluir" })).not.toBeInTheDocument();
  });
});
