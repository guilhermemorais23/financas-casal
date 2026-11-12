// Funções desligadas somem do menu, das abas de Contas e ligam/desligam pela
// tela Conta e grupo.
import { describe, expect, it, vi } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { fakeAuth, members } from "../test/fakeAuth";
import { renderPage } from "../test/render";
import { MODULE_KEYS, type ModuleKey, type Preferences } from "../utils/preferences";

vi.unmock("../layouts/AppLayout");
vi.mock("../firebase", () => ({ firebaseAuth: {} }));

const { AppLayout } = await import("./AppLayout");
const { BillsTabs } = await import("../components/BillsTabs");
const { AccountPage } = await import("../pages/AccountPage");

function prefsWithout(...off: ModuleKey[]): Preferences {
  const modules = Object.fromEntries(MODULE_KEYS.map((key) => [key, !off.includes(key)])) as Preferences["modules"];
  return { usage: "couple", goals: ["spending"], modules };
}

function prepareLayout() {
  onApi("GET", "/groups/me", {
    group: { id: "group-1", nickname: null, emoji: null },
    members,
    accounts: [],
    pendingInviteToken: null,
  });
  onApi("GET", "/groups", { groups: [{ id: "group-1", name: "Nós", memberCount: 2 }] });
  onApi("GET", "/feedback/unread", { unread: 0 });
  onApi("GET", "/feedback", { messages: [] });
  onApi("GET", "/assistant/greeting", { text: "Oi" });
}

describe("menu sem as funções desligadas", () => {
  it("no PC: Relatórios, Metas e Lista de compras somem; o resto fica", async () => {
    fakeAuth.user.preferences = prefsWithout("reports", "goals", "shopping");
    prepareLayout();
    const screen = await renderPage(<AppLayout><p>conteúdo</p></AppLayout>, { width: 1280 });
    const nav = screen.getByRole("navigation", { name: "Menu principal" }).first();
    await expect.element(nav.getByRole("link", { name: "Painel" })).toBeVisible();
    await expect.element(nav.getByRole("link", { name: "Contas" })).toBeVisible();
    await expect.element(nav.getByRole("link", { name: "Relatórios" })).not.toBeInTheDocument();
    await expect.element(nav.getByRole("link", { name: "Metas" })).not.toBeInTheDocument();
    await expect.element(nav.getByRole("link", { name: "Lista de compras" })).not.toBeInTheDocument();
  });

  it("sem nenhuma conta ligada, Contas sai do menu; a folha Mais esconde Metas", async () => {
    fakeAuth.user.preferences = prefsWithout("cards", "payables", "debts", "loans", "goals");
    prepareLayout();
    const screen = await renderPage(<AppLayout><p>conteúdo</p></AppLayout>, { width: 390 });
    await expect.element(screen.getByText("conteúdo")).toBeVisible();
    const bottom = document.querySelector(".app-bottom-nav")!;
    expect(bottom.textContent).not.toContain("Contas");
    await screen.getByRole("button", { name: "Mais", exact: true }).click();
    const sheet = screen.getByRole("dialog", { name: "Mais opções" });
    await expect.element(sheet.getByRole("link", { name: "Relatórios" })).toBeVisible();
    await expect.element(sheet.getByRole("link", { name: "Metas" })).not.toBeInTheDocument();
  });

  it("sem resposta (preferences null): tudo aparece, como antes", async () => {
    prepareLayout();
    const screen = await renderPage(<AppLayout><p>conteúdo</p></AppLayout>, { width: 1280 });
    const nav = screen.getByRole("navigation", { name: "Menu principal" }).first();
    for (const name of ["Relatórios", "Contas", "Metas", "Lista de compras"]) {
      await expect.element(nav.getByRole("link", { name })).toBeVisible();
    }
  });
});

describe("abas de Contas", () => {
  it("cartões e empréstimos desligados: só Todas e A pagar", async () => {
    fakeAuth.user.preferences = prefsWithout("cards", "loans");
    const screen = await renderPage(<BillsTabs />, { route: "/contas" });
    const tabs = screen.getByRole("navigation", { name: "Contas" });
    await expect.element(tabs.getByRole("link", { name: /Todas/ })).toBeVisible();
    await expect.element(tabs.getByRole("link", { name: /A pagar/ })).toBeVisible();
    await expect.element(tabs.getByRole("link", { name: /Cartões/ })).not.toBeInTheDocument();
    await expect.element(tabs.getByRole("link", { name: /Emprést/ })).not.toBeInTheDocument();
  });
});

describe("Conta e grupo: Funções do app", () => {
  function prepareAccount() {
    prepareLayout();
    onApi("GET", /^\/budgets\/current/, { budget: null, spent: 0 });
    onApi("GET", /^\/budgets\/categories/, []);
    onApi("GET", "/categories", []);
    onApi("GET", "/open-finance/status", { configured: false, allowed: false });
    onApi("GET", "/push", { publicKey: null });
    onApi("GET", "/statements/rules", { rules: [] });
  }

  it("desligar Cartões manda o PATCH só com ele e guarda a resposta", async () => {
    prepareAccount();
    const after = prefsWithout("cards");
    onApi("PATCH", "/me/preferences/modules", after);
    const screen = await renderPage(<AccountPage />, { route: "/account" });

    const cards = screen.getByRole("switch", { name: "Cartões" });
    await expect.element(cards).toHaveAttribute("aria-checked", "true");
    await cards.click();
    await expect.poll(() => callsTo("PATCH", "/me/preferences/modules").map((c) => c.body)).toEqual([{ cards: false }]);
    await expect.element(cards).toHaveAttribute("aria-checked", "false");
    expect(fakeAuth.user.preferences).toEqual(after);
  });

  it("religar Metas manda true", async () => {
    fakeAuth.user.preferences = prefsWithout("goals");
    prepareAccount();
    onApi("PATCH", "/me/preferences/modules", prefsWithout());
    const screen = await renderPage(<AccountPage />, { route: "/account" });
    const goals = screen.getByRole("switch", { name: "Metas" });
    await expect.element(goals).toHaveAttribute("aria-checked", "false");
    await goals.click();
    await expect.poll(() => callsTo("PATCH", "/me/preferences/modules").map((c) => c.body)).toEqual([{ goals: true }]);
  });
});
