// Painel simples: "Pode gastar hoje" no topo, Últimos 7 dias e Precisa de
// atenção logo abaixo, Primeiros passos, e o resto do mês recolhido em "Ver
// mais do mês". Funções desligadas não aparecem.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { fakeAuth, ME } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { MODULE_KEYS, type ModuleKey, type Preferences } from "../utils/preferences";
import { DashboardPage } from "./DashboardPage";

function setup(extra: Record<string, unknown> = {}) {
  onApi("GET", /^\/dashboard\?month=/, {
    group: {
      accounts: [{ id: "acc-me", type: "personal", name: "Eu", balance: 500 }],
      members: [{ id: ME, displayName: "Eu" }],
    },
    recent: [], debts: [], summary: { total: "0", byCategory: [] }, jointSummary: { byPayer: [] }, balance: { balances: [] },
    budget: { budget: null, spent: 0 }, categoryBudgets: [], dailyTrend: [],
    personalMonthTotals: { income: 3000, expense: 1000 }, personalPrevMonthTotals: { income: 0, expense: 0 },
    goalHighlight: null, nextInvoice: null, trend6m: [], alerts: [],
    recentDays: { from: "2026-11-06", to: "2026-11-12", total: "0.00", byCategory: [] },
    ...extra,
  });
  onApi("GET", /^\/transactions\?limit=1/, [{}]);
  onApi("GET", "/open-finance/pending", { total: 0, banks: [] });
  onApi("GET", /^\/transactions\/uncategorized/, { count: 0 });
  onApi("GET", /^\/month-close/, { hasActivity: false });
  onApi("GET", /^\/bills\/reminders/, { reminders: [] });
  onApi("POST", "/onboarding/checklist/dismiss", null);
}

function region(name: string) {
  return document.querySelector(`[aria-label="${name}"]`);
}

function prefsWithout(...off: ModuleKey[]): Preferences {
  const modules = Object.fromEntries(MODULE_KEYS.map((key) => [key, !off.includes(key)])) as Preferences["modules"];
  return { usage: "solo", goals: [], modules };
}

describe("Painel: o que aparece primeiro", () => {
  it("Pode gastar hoje vem antes de Últimos 7 dias, Precisa de atenção e Últimos lançamentos", async () => {
    setup();
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Pode gastar hoje")).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Últimos lançamentos" })).toBeInTheDocument();

    const hero = screen.getByText("Pode gastar hoje").element();
    const order = ["Últimos 7 dias", "Precisa de atenção", "Últimos lançamentos"].map((name) => region(name)!);
    for (const el of order) expect(hero.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // O saldo do mês continua lá, menor.
    await expect.element(screen.getByText(/R\$\s?2\.000,00/)).toBeInTheDocument();
  });

  it("o resto fica em Ver mais do mês, que abre e é lembrado", async () => {
    setup();
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Pode gastar hoje")).toBeVisible();
    expect(region("Onde está seu dinheiro")).toBeNull();

    await screen.getByRole("button", { name: "Ver mais do mês" }).click();
    await expect.element(screen.getByRole("region", { name: "Onde está seu dinheiro" })).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Orçamento do mês" })).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Ver menos" })).toHaveAttribute("aria-expanded", "true");
    expect(localStorage.getItem(`par:painel-mais:${ME}`)).toBe("1");
  });
});

describe("Painel: primeiros passos", () => {
  const checklist = {
    steps: [
      { id: "first_transaction", done: true },
      { id: "invite_partner", done: false },
      { id: "set_budget", done: false },
    ],
    completedAt: null,
  };

  it("mostra o progresso e o atalho de cada passo", async () => {
    setup({ checklist });
    const screen = await renderPage(<DashboardPage />);
    const card = screen.getByRole("region", { name: "Primeiros passos" });
    await expect.element(card.getByText("1 de 3")).toBeVisible();
    await expect.element(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await expect.element(card.getByRole("link", { name: "Convidar" })).toHaveAttribute("href", "/account#convite");
    await expect.element(card.getByRole("link", { name: "Definir" })).toHaveAttribute("href", "/account#orcamento");
    await expect.element(card.getByRole("link", { name: "Lançar" })).not.toBeInTheDocument();
  });

  it("Dispensar avisa o servidor e some na hora", async () => {
    setup({ checklist });
    const screen = await renderPage(<DashboardPage />);
    await screen.getByRole("button", { name: "Dispensar" }).click();
    await expect.element(screen.getByRole("region", { name: "Primeiros passos" })).not.toBeInTheDocument();
    await expect.poll(() => callsTo("POST", "/onboarding/checklist/dismiss").length).toBe(1);
  });

  it("tudo feito: parabéns e Fechar", async () => {
    setup({
      checklist: { steps: checklist.steps.map((step) => ({ ...step, done: true })), completedAt: "2026-11-12T10:00:00Z" },
    });
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Parabéns! Tudo pronto.")).toBeVisible();
    await screen.getByRole("button", { name: "Fechar" }).click();
    await expect.element(screen.getByText("Parabéns! Tudo pronto.")).not.toBeInTheDocument();
    await expect.poll(() => callsTo("POST", "/onboarding/checklist/dismiss").length).toBe(1);
  });

  it("sem checklist (null) não mostra nada", async () => {
    setup({ checklist: null });
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Pode gastar hoje")).toBeVisible();
    expect(region("Primeiros passos")).toBeNull();
  });
});

describe("Painel: funções desligadas", () => {
  const extra = {
    debts: [{ id: "d1", name: "Geladeira", totalAmount: "1000", installmentsCount: 10, paidAmount: 100, remainingAmount: 900, remainingCount: 9 }],
    cardsSummary: [{ id: "c1", name: "Nubank", limit: null, limitUsed: null, limitType: "normal", statementTotal: "0", statementIsPaid: false, dueDate: "2026-11-20" }],
    goalsSummary: [{ id: "g1", name: "Viagem", currentAmount: "10", targetAmount: "100", deadline: null, itemsCount: 0 }],
    upcoming: [
      { id: "u1", kind: "card", direction: "pay", title: "Fatura Nubank", detail: "Cartão", amount: 50, dueDate: "2026-11-20", daysUntil: 3, link: "/cards" },
      { id: "u2", kind: "recurring", direction: "pay", title: "Internet", detail: "Conta fixa", amount: 100, dueDate: "2026-11-21", daysUntil: 4, link: "/a-pagar" },
    ],
  };

  it("cartões, metas e dívidas desligados somem do Painel", async () => {
    fakeAuth.user.preferences = prefsWithout("cards", "goals", "debts");
    setup(extra);
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Internet")).toBeVisible();
    expect(screen.getByText("Fatura Nubank").query()).toBeNull();

    await screen.getByRole("button", { name: "Ver mais do mês" }).click();
    await expect.element(screen.getByRole("region", { name: "Orçamento do mês" })).toBeVisible();
    expect(region("Cartões")).toBeNull();
    expect(region("Metas")).toBeNull();
    expect(region("Dívidas")).toBeNull();
  });

  it("tudo ligado: os mesmos blocos aparecem", async () => {
    setup(extra);
    const screen = await renderPage(<DashboardPage />);
    await expect.element(screen.getByText("Fatura Nubank")).toBeVisible();
    await screen.getByRole("button", { name: "Ver mais do mês" }).click();
    await expect.element(screen.getByRole("region", { name: "Cartões" })).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Metas" })).toBeVisible();
    await expect.element(screen.getByRole("region", { name: "Dívidas" })).toBeVisible();
  });
});
