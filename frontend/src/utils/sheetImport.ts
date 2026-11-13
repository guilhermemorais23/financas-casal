// Lê a planilha antiga (Excel ou CSV) de quem controlava tudo à mão e
// transforma em linhas pra importar na Planilha do PAR.
//
// O formato que a gente espera é o mais comum:
//
//            Jan     Fev     Mar   ...
//   Casa                                  <- sem valores: é um grupo
//   Hipoteca 2.850   2.850   2.850        <- linha do grupo Casa
//   Água     118,40  120,10  ...
//   Total    ...                          <- total/saldo/sobra: pulado
//   Receitas                              <- grupo de receita
//   Aposentadoria 6.800 ...
//
// A linha dos meses pode estar em qualquer lugar do começo, com "Jan",
// "janeiro", "jan/26" ou datas. Tudo aparece numa prévia antes de importar,
// e a pessoa desmarca o que não for lançamento.

export type CellValue = string | number | boolean | Date | null | undefined;

export interface SheetImportRow {
  group: string | null;
  name: string;
  transactionType: "expense" | "income";
  months: (number | null)[];
}

export interface SheetImportParse {
  rows: SheetImportRow[];
  // Ano escrito na planilha ("jan/26", "2026"), quando tem.
  year: number | null;
  // Quantos meses a linha de cabeçalho trouxe.
  monthsFound: number;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const INCOME_WORDS = /receita|renda|entrada|ganho|salario|aposentadoria|recebid/;
const SKIP_WORDS = /^(total|soma|subtotal|saldo|sobra|sobrou|resultado|diferen)/;

const plain = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

function monthOf(cell: CellValue): { month: number; year: number | null } | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return { month: cell.getMonth(), year: cell.getFullYear() };
  if (typeof cell !== "string") return null;
  const text = plain(cell);
  const m = text.match(/^([a-z]{3})[a-z]*\.?\s*(?:[/\-\s]\s*(\d{2,4}))?$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  const year = m[2] ? (m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2])) : null;
  return { month, year };
}

// "R$ 1.234,56", "1234.56", "(50,00)", 1234.56 -> número positivo; vazio -> null.
export function moneyOf(cell: CellValue): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) && cell !== 0 ? Math.round(Math.abs(cell) * 100) / 100 : null;
  if (typeof cell !== "string") return null;
  let text = cell.replace(/R\$|\s/g, "").replace(/[()]/g, "").replace(/^-/, "");
  if (!/\d/.test(text) || /[a-z]/i.test(text)) return null;
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > -1 && comma > dot) text = text.replace(/\./g, "").replace(",", ".");
  else if (comma > -1) text = text.replace(/,/g, "");
  else if (dot > -1 && /^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  const value = Number(text);
  return Number.isFinite(value) && value !== 0 ? Math.round(Math.abs(value) * 100) / 100 : null;
}

const textOf = (cell: CellValue) => (typeof cell === "string" ? cell.trim() : typeof cell === "number" ? "" : "");

export function parseSheetGrid(grid: CellValue[][]): SheetImportParse {
  // 1. A linha dos meses: a primeira (nas 20 primeiras) com 3 meses ou mais.
  let headerIndex = -1;
  let monthCols: number[] = Array(12).fill(-1);
  let year: number | null = null;
  for (let r = 0; r < Math.min(grid.length, 20) && headerIndex < 0; r++) {
    const cols: number[] = Array(12).fill(-1);
    let found = 0;
    let rowYear: number | null = null;
    grid[r].forEach((cell, c) => {
      const month = monthOf(cell);
      if (month && cols[month.month] < 0) {
        cols[month.month] = c;
        found++;
        rowYear = rowYear ?? month.year;
      }
    });
    if (found >= 3) {
      headerIndex = r;
      monthCols = cols;
      year = rowYear;
    }
  }
  if (headerIndex < 0) return { rows: [], year: null, monthsFound: 0 };
  if (year === null) {
    for (const row of grid.slice(0, headerIndex + 1)) {
      for (const cell of row) {
        const m = typeof cell === "string" ? cell.match(/\b(20\d{2})\b/) : typeof cell === "number" && cell >= 2000 && cell <= 2100 ? [String(cell), String(cell)] : null;
        if (m) year = Number(m[1]);
      }
    }
  }

  // 2. A coluna do nome: a que mais tem texto, à esquerda do primeiro mês.
  const firstMonthCol = Math.min(...monthCols.filter((c) => c >= 0));
  let nameCol = 0;
  let best = -1;
  for (let c = 0; c < Math.max(firstMonthCol, 1); c++) {
    const count = grid.slice(headerIndex + 1).filter((row) => textOf(row[c]).length > 0).length;
    if (count > best) {
      best = count;
      nameCol = c;
    }
  }

  // 3. As linhas: sem valor = grupo; total/saldo = pula; o resto = lançamento.
  const rows: SheetImportRow[] = [];
  let group: string | null = null;
  let groupIsIncome = false;
  for (const row of grid.slice(headerIndex + 1)) {
    const name = textOf(row[nameCol]).replace(/\s+/g, " ").slice(0, 60);
    if (!name) continue;
    const key = plain(name);
    if (SKIP_WORDS.test(key)) continue;
    const months = monthCols.map((c) => (c >= 0 ? moneyOf(row[c]) : null));
    if (months.every((value) => value === null)) {
      group = name;
      groupIsIncome = INCOME_WORDS.test(key);
      continue;
    }
    rows.push({
      group,
      name,
      transactionType: groupIsIncome || (!group && INCOME_WORDS.test(key)) ? "income" : "expense",
      months,
    });
  }
  return { rows, year, monthsFound: monthCols.filter((c) => c >= 0).length };
}

// CSV simples (ponto e vírgula ou vírgula), pra quem exporta do Google Sheets.
export function parseCsvGrid(text: string): CellValue[][] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === delimiter && !quoted) {
        cells.push(current);
        current = "";
      } else current += ch;
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
  });
}
