// Painel: "Últimos 7 dias" -- gasto por categoria na janela que anda.
import { describe, expect, it } from "vitest";
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { DashboardPage } from "./DashboardPage";

function setup(recentDays: unknown) {
  const totals = { income: 0, expense: 0 };
  onApi("GET", /^\/dashboard\?month=/, {
    group: {
      accounts: [{ id: "acc-me", type: "personal", name: "Eu", balance: 0 }],
      members: [{ id: ME, displayName: "Eu" }],
    },
    recent: [], debts: [], summary: { total: "0", byCategory: [] }, jointSummary: { byPayer: [] }, balance: { balances: [] },
    budget: { budget: null, spent: 0 }, categoryBudgets: [], dailyTrend: [], personalMonthTotals: totals,
    personalPrevMonthTotals: totals, goalHighlight: null, nextInvoice: null, trend6m: [], alerts: [], recentDays,
  });
  onApi("GET", /^\/transactions\?limit=1/, [{}]);
  onApi("GET", "/open-finance/pending", { total: 0, banks: [] });
  onApi("GET", /^\/transactions\/uncategorized/, { count: 0 });
  onApi("GET", /^\/month-close/, { hasActivity: false });
}

describe("Painel: últimos 7 dias", () => {
  it("mostra cada categoria com quanto foi e o total", async () => {
    setup({
      from: "2026-11-06",
      to: "2026-11-12",
      total: "85.50",
      byCategory: [
        { categoryId: "c1", categoryName: "Fast food", categoryEmoji: "🍔", total: "60.00" },
        { categoryId: null, categoryName: null, categoryEmoji: null, total: "25.50" },
      ],
    });
    const screen = await renderPage(<DashboardPage />);
    const card = screen.getByRole("region", { name: "Últimos 7 dias" });
    await expect.element(card.getByText("🍔 Fast food")).toBeInTheDocument();
    await expect.element(card.getByText("Sem categoria")).toBeInTheDocument();
    await expect.element(card.getByText(/R\$\s?85,50/)).toBeInTheDocument();
    await expect.element(card.getByText(/De 6 nov até hoje/)).toBeInTheDocument();
  });

  it("sem gasto na semana: avisa que está vazio", async () => {
    setup({ from: "2026-11-06", to: "2026-11-12", total: "0.00", byCategory: [] });
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Nenhum gasto nos últimos 7 dias.")).toBeInTheDocument();
  });

  it("mês passado (recentDays null): o card não aparece", async () => {
    setup(null);
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByRole("region", { name: "Últimos lançamentos" })).toBeInTheDocument();
    await expect.element(screen.getByRole("region", { name: "Últimos 7 dias" })).not.toBeInTheDocument();
  });
});
