// Relatório (extrato do mês): os três problemas que chegaram ao ar --
// cabeçalho do dia amassado, barra de seleção com botão por cima do texto, e
// parcela de dívida sem "Excluir".
import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { onApi } from "../test/fakeApi";
import { ME } from "../test/fakeAuth";
import { isInside, overlaps, renderPage } from "../test/render";
import { ReportsPage } from "./ReportsPage";

const MONTH = "2026-11";

function tx(over: Record<string, unknown>) {
  return {
    id: "tx",
    description: "Lançamento",
    amount: "10.00",
    transactionType: "expense",
    occurredAt: "2026-11-01",
    categoryId: null,
    categoryName: null,
    categoryEmoji: null,
    isPrivate: false,
    recurringGroupId: null,
    splitType: "none",
    isSettled: false,
    accountId: "acc-me",
    accountType: "personal",
    paymentMethod: null,
    payerId: ME,
    linkKind: null,
    ...over,
  };
}

const transactions = [
  // Dia com gasto E receita: o que amassava o cabeçalho.
  tx({ id: "red-bull", description: "Red bull", amount: "1148.12", occurredAt: "2026-11-17", categoryName: "Alimentação" }),
  tx({ id: "salario", description: "Salário", amount: "2770.80", transactionType: "income", occurredAt: "2026-11-17" }),
  // Parcelas do Nubank (geradas em Dívidas).
  tx({ id: "nubank-1", description: "Nubank — parcela 1/5", amount: "57.79", linkKind: "debt_installment" }),
  tx({ id: "nubank-2", description: "Nubank — parcela 2/5", amount: "57.79", linkKind: "debt_installment" }),
  // Reembolso: continua só desfazendo na despesa original.
  tx({ id: "pix-aisha", description: "Reembolso da aisha", amount: "40.00", transactionType: "income", linkKind: "settlement" }),
];

beforeEach(() => {
  onApi("GET", /^\/transactions\/summary\?month=/, { total: "1263.70", byCategory: [] });
  onApi("GET", /^\/transactions\?limit=500&month=/, transactions);
  onApi("GET", /^\/transactions\/summary\/year\?/, { year: 2026, months: [], totalIncome: "0", totalExpense: "0" });
});

async function openReports(width: number, frameWidth?: number) {
  const screen = await renderPage(<ReportsPage />, { route: `/reports?month=${MONTH}`, width, frameWidth });
  await expect.element(screen.getByText("Red bull")).toBeInTheDocument();
  return screen;
}

function dayHeader(label: RegExp) {
  const li = [...document.querySelectorAll(".report-group")].find((el) => label.test(el.textContent ?? ""));
  if (!li) throw new Error(`cabeçalho ${label} não encontrado`);
  return {
    li,
    header: li.querySelector(".report-group-header")!,
    total: li.querySelector(".report-group-total")!,
    select: li.querySelector(".report-group-select")!,
  };
}

describe("cabeçalho do dia", () => {
  // [tela, coluna]: celular, tablet, e PC com o extrato numa coluna estreita
  // (o caso do print -- a regra que empilhava os valores só valia no celular).
  const sizes: [number, number | undefined][] = [[320, undefined], [390, undefined], [768, undefined], [1280, 380]];
  for (const [width, frameWidth] of sizes) {
    it(`com gasto e receita, o total não passa por cima do "Selecionar" (${width}px${frameWidth ? `, coluna de ${frameWidth}px` : ""})`, async () => {
      await openReports(width, frameWidth);
      const { li, header, total, select } = dayHeader(/17 de novembro/);
      expect(overlaps(total, select)).toBe(false);
      expect(isInside(total, header)).toBe(true);
      expect(isInside(select, li)).toBe(true);
    });
  }
});

describe("barra de seleção", () => {
  for (const width of [320, 390, 1024]) {
    it(`texto, Cancelar e Excluir não se sobrepõem e cabem na tela (${width}px)`, async () => {
      const screen = await openReports(width);
      await screen.getByRole("button", { name: /Selecionar os lançamentos de 17 de novembro/ }).click();

      const bar = document.querySelector(".selection-bar")!;
      await expect.element(screen.getByText("2 selecionados")).toBeInTheDocument();
      const text = bar.querySelector(".selection-bar-text")!;
      const cancel = screen.getByRole("button", { name: "Cancelar" }).element();
      const remove = screen.getByRole("button", { name: "Excluir", exact: true }).element();

      expect(overlaps(text, cancel)).toBe(false);
      expect(overlaps(text, remove)).toBe(false);
      expect(overlaps(cancel, remove)).toBe(false);
      for (const el of [text, cancel, remove]) expect(isInside(el, bar)).toBe(true);
      expect(bar.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      // Os dois botões da mesma altura (o .btn + .btn global dava margem no segundo).
      expect(Math.round(cancel.getBoundingClientRect().top)).toBe(Math.round(remove.getBoundingClientRect().top));
    });
  }
});

describe("excluir lançamento ligado", () => {
  it("parcela de dívida tem Excluir, e a confirmação avisa que a parcela volta a ficar em aberto", async () => {
    const screen = await openReports(390);
    const row = screen.getByRole("listitem").filter({ hasText: "Nubank — parcela 1/5" });
    await row.getByTitle("Mais ações").click();
    await screen.getByRole("menuitem", { name: "Excluir" }).click();

    const dialog = screen.getByRole("alertdialog");
    await expect.element(dialog).toMatchTextContent(/parcela de dívida: ela volta a ficar em aberto em Dívidas/);
  });

  it("parcela de dívida pode ser marcada na seleção", async () => {
    const screen = await openReports(390);
    await screen.getByRole("button", { name: /Selecionar os lançamentos de 1 de novembro/ }).click();
    await expect.element(screen.getByRole("checkbox", { name: "Selecionar Nubank — parcela 1/5" })).toBeChecked();
    await expect.element(screen.getByRole("checkbox", { name: "Selecionar Reembolso da aisha" })).toBeDisabled();
  });

  it('reembolso não tem Excluir, mas tem "Como excluir" com o caminho', async () => {
    const screen = await openReports(390);
    const row = screen.getByRole("listitem").filter({ hasText: "Reembolso da aisha" });
    await row.getByTitle("Mais ações").click();
    await expect.element(screen.getByRole("menuitem", { name: "Excluir" })).not.toBeInTheDocument();
    await screen.getByRole("menuitem", { name: "Como excluir" }).click();
    await expect.element(page.getByText(/marcando a despesa como em aberto/)).toBeInTheDocument();
  });
});
