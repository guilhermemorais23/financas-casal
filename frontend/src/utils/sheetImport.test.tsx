// Ler a planilha antiga: acha a linha dos meses, os grupos e as linhas, e
// pula total e saldo.
import { describe, expect, it } from "vitest";
import { moneyOf, parseCsvGrid, parseSheetGrid } from "./sheetImport";

describe("parseSheetGrid", () => {
  it("grupo sem valor vira a categoria de cima; total e saldo ficam de fora; receitas à parte", () => {
    const grid = [
      ["Controle 2026"],
      ["", "Jan", "Fev", "Mar"],
      ["Casa", null, null, null],
      ["Hipoteca", 2850, 2850, 2850],
      ["Água", "118,40", "R$ 120,10", ""],
      ["Total Casa", 2968.4, 2970.1, 2850],
      ["Receitas", "", "", ""],
      ["Aposentadoria", "6.800,00", "6.800,00", "6.800,00"],
      ["Saldo", 3831.6, 3829.9, 3950],
    ];
    const parsed = parseSheetGrid(grid);
    expect(parsed.year).toBe(2026);
    expect(parsed.monthsFound).toBe(3);
    expect(parsed.rows.map((row) => [row.group, row.name, row.transactionType, row.months.slice(0, 3)])).toEqual([
      ["Casa", "Hipoteca", "expense", [2850, 2850, 2850]],
      ["Casa", "Água", "expense", [118.4, 120.1, null]],
      ["Receitas", "Aposentadoria", "income", [6800, 6800, 6800]],
    ]);
    expect(parsed.rows[0].months).toHaveLength(12);
  });

  it("entende janeiro por extenso, fev/26 e datas no cabeçalho", () => {
    expect(parseSheetGrid([["Item", "janeiro", "fevereiro", "março"], ["Luz", 300, 310, 290]]).rows[0].months.slice(0, 3)).toEqual([300, 310, 290]);
    expect(parseSheetGrid([["Item", "jan/26", "fev/26", "mar/26"], ["Luz", 1, 2, 3]]).year).toBe(2026);
    const dates = [new Date(2025, 0, 1), new Date(2025, 1, 1), new Date(2025, 2, 1)];
    expect(parseSheetGrid([["Item", ...dates], ["Luz", 1, 2, 3]]).year).toBe(2025);
  });

  it("sem a linha dos meses não inventa nada", () => {
    expect(parseSheetGrid([["Nome", "Valor"], ["Luz", 300]])).toEqual({ rows: [], year: null, monthsFound: 0 });
  });
});

describe("moneyOf e CSV", () => {
  it("lê os formatos de dinheiro e ignora texto", () => {
    expect(moneyOf("R$ 1.234,56")).toBe(1234.56);
    expect(moneyOf("1234.56")).toBe(1234.56);
    expect(moneyOf("1.234")).toBe(1234);
    expect(moneyOf("(50,00)")).toBe(50);
    expect(moneyOf(-80)).toBe(80);
    expect(moneyOf("pago")).toBeNull();
    expect(moneyOf("")).toBeNull();
  });

  it("CSV com ponto e vírgula e aspas", () => {
    expect(parseCsvGrid('Item;Jan;Fev\n"Luz; água";10,50;20\n')).toEqual([
      ["Item", "Jan", "Fev"],
      ["Luz; água", "10,50", "20"],
    ]);
  });
});
