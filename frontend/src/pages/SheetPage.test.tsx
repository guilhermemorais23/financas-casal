// Planilha: os três números do topo, o ano com categoria abrindo em
// subcategorias, e tocar num valor mostra os lançamentos de dentro.
import { describe, expect, it } from "vitest";
import { callsTo, onApi } from "../test/fakeApi";
import { renderPage } from "../test/render";
import { SheetPage } from "./SheetPage";

const months = (values: Record<number, string>) => Array.from({ length: 12 }, (_, i) => values[i] ?? "0.00");

function setup() {
  onApi("GET", /^\/sheet\?year=/, {
    year: 2026,
    categories: [
      { id: "casa", name: "Casa", type: "expense", parentId: null },
      { id: "hipoteca", name: "Hipoteca", type: "expense", parentId: "casa" },
      { id: "agua", name: "Água", type: "expense", parentId: "casa" },
      { id: "receita", name: "Aposentadoria", type: "income", parentId: null },
    ],
    rows: [
      { categoryId: "hipoteca", transactionType: "expense", months: months({ 2: "2850.00" }), total: "2850.00" },
      { categoryId: "agua", transactionType: "expense", months: months({ 2: "120.00" }), total: "120.00" },
      { categoryId: "receita", transactionType: "income", months: months({ 2: "6800.00" }), total: "6800.00" },
    ],
    tags: [{ tag: "remédio", count: 2, total: "130.30" }],
  });
  onApi("GET", "/loans", { summary: { outstanding: "25600.00" }, moneyToday: 18450 });
  onApi("GET", /^\/sheet\/entries\?/, [
    { id: "t1", date: "2026-03-05", description: "Parcela da casa", amount: "2850.00", transactionType: "expense", categoryId: "hipoteca", tags: ["casa"] },
  ]);
}

describe("Planilha", () => {
  it("mostra na conta, a receber e depois de receber", async () => {
    setup();
    const screen = await renderPage(<SheetPage />, { width: 1280 });
    const band = screen.getByRole("region", { name: "Quanto você tem" });
    await expect.element(band.getByText(/R\$\s?18\.450,00/)).toBeVisible();
    await expect.element(band.getByText(/R\$\s?25\.600,00/)).toBeVisible();
    await expect.element(band.getByText(/R\$\s?44\.050,00/)).toBeVisible();
  });

  it("Casa soma as subcategorias, fecha e abre; sobrou no mês", async () => {
    setup();
    const screen = await renderPage(<SheetPage />, { width: 1280 });
    const table = screen.getByRole("region", { name: "Planilha de 2026" });
    await expect.element(table.getByRole("rowheader", { name: "Hipoteca" })).toBeVisible();
    const text = (name: RegExp) => table.getByRole("row", { name }).element().textContent ?? "";
    expect(text(/^Casa/)).toContain("2.970,00");
    expect(text(/Sobrou no mês/)).toContain("3.830,00");
    await table.getByRole("button", { name: "Casa" }).click();
    await expect.element(table.getByRole("rowheader", { name: "Hipoteca" })).not.toBeInTheDocument();
  });

  it("tocar num valor mostra os lançamentos com as marcações", async () => {
    setup();
    const screen = await renderPage(<SheetPage />, { width: 1280 });
    const row = screen.getByRole("row", { name: /^Hipoteca/ });
    await row.getByRole("button", { name: /2\.850,00/ }).click();
    await expect
      .poll(() => callsTo("GET", /^\/sheet\/entries\?/).map((c) => c.path))
      .toContain("/sheet/entries?year=2026&month=3&categoryId=hipoteca");
    const list = screen.getByRole("region", { name: "Lançamentos" });
    await expect.element(list.getByText("Parcela da casa")).toBeVisible();
    await expect.element(list.getByText("#casa")).toBeVisible();
    await expect.element(list.getByText("Casa › Hipoteca · Mar")).toBeVisible();
  });
});
