// Reads a bank statement export (OFX or CSV) into plain rows. Pure functions,
// no I/O: the caller decides what to do with the rows (preview, dedupe,
// save). Amounts keep the file's own sign here (negative = money out); the
// caller can flip them if the bank exports expenses as positive numbers.
export interface ParsedStatementRow {
  date: string; // YYYY-MM-DD
  description: string;
  amountCents: number; // signed: negative = expense
  externalId: string | null; // OFX FITID, when the file has one
}

export type StatementFormat = "ofx" | "csv";

export class StatementParseError extends Error {}

export function detectFormat(text: string): StatementFormat {
  return /<OFX>|<STMTTRN>|OFXHEADER/i.test(text) ? "ofx" : "csv";
}

export function parseStatement(text: string): { format: StatementFormat; rows: ParsedStatementRow[] } {
  const clean = text.replace(/^﻿/, "");
  const format = detectFormat(clean);
  const rows = format === "ofx" ? parseOfx(clean) : parseCsv(clean);
  if (rows.length === 0) {
    throw new StatementParseError("Não encontrei lançamentos nesse arquivo.");
  }
  return { format, rows };
}

// ---- amounts & dates ---------------------------------------------------

// "1.234,56", "-1234.56", "R$ 12,50", "(12,50)", "12,50-" -> cents (signed).
export function parseAmountToCents(raw: string): number | null {
  let value = raw.trim();
  if (!value) return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (value.endsWith("-")) {
    negative = true;
    value = value.slice(0, -1);
  }
  value = value.replace(/[^\d.,-]/g, "");
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  }
  if (!/\d/.test(value)) return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  let normalized: string;
  if (lastComma > -1 && lastDot > -1) {
    // Both present: whichever comes last is the decimal separator.
    normalized =
      lastComma > lastDot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = value.replace(",", ".");
  } else {
    normalized = value;
  }
  const number = Number(normalized);
  if (!Number.isFinite(number)) return null;
  const cents = Math.round(number * 100);
  return negative ? -cents : cents;
}

// DD/MM/YYYY, DD/MM/YY, DD-MM-YYYY, YYYY-MM-DD, YYYYMMDD[...] -> YYYY-MM-DD.
export function parseDate(raw: string): string | null {
  const value = raw.trim();
  let year: number, month: number, day: number;
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = value.match(/^(\d{4})(\d{2})(\d{2})/))) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---- OFX ---------------------------------------------------------------

// OFX 1.x is SGML (tags are often never closed), OFX 2.x is XML. Reading
// "<TAG>value up to the next tag or line break" handles both.
function ofxTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, "i"));
  return match ? match[1].trim() : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function parseOfx(text: string): ParsedStatementRow[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const rows: ParsedStatementRow[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(ofxTag(block, "DTPOSTED") ?? "");
    const amountCents = parseAmountToCents(ofxTag(block, "TRNAMT") ?? "");
    if (!date || amountCents === null || amountCents === 0) continue;
    const memo = ofxTag(block, "MEMO");
    const name = ofxTag(block, "NAME");
    const description = decodeEntities((memo && memo.length >= (name?.length ?? 0) ? memo : name ?? memo ?? "").trim());
    rows.push({
      date,
      description: description || "Lançamento importado",
      amountCents,
      externalId: ofxTag(block, "FITID"),
    });
  }
  return rows;
}

// ---- CSV ---------------------------------------------------------------

function detectDelimiter(headerLine: string): string {
  const counts = [";", ",", "\t"].map((d) => [d, headerLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// RFC 4180-ish: quoted fields may contain the delimiter, quotes ("" = ").
export function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

interface CsvColumns {
  date: number;
  // Colunas de texto na ordem de preferência: a linha usa a primeira que
  // tiver um nome de verdade (não só número).
  description: number[];
  amount: number;
  debit: number;
  credit: number;
}

function findColumns(header: string[]): CsvColumns | null {
  const names = header.map(normalizeHeader);
  const taken = new Set<number>();
  // Padrão por padrão (não coluna por coluna): "Data Lançamento" não pode
  // virar a descrição só porque vem antes de "Descrição".
  const find = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const index = names.findIndex((name, i) => !taken.has(i) && pattern.test(name));
      if (index >= 0) {
        taken.add(index);
        return index;
      }
    }
    return -1;
  };
  const date = find([/^data/, /^date/]);
  const amount = find([/^valor/, /^amount/, /^quantia/]);
  const debit = find([/^debito/, /^saida/, /^debit/]);
  const credit = find([/^credito/, /^entrada/, /^credit/]);
  find([/^saldo/, /^balance/]);
  const description: number[] = [];
  for (const pattern of [/descri/, /estabelecimento/, /favorecido/, /^nome/, /title/, /titulo/, /memo/, /historico/, /lancamento/]) {
    const index = find([pattern]);
    if (index >= 0) description.push(index);
  }
  if (date < 0 || description.length === 0) return null;
  if (amount < 0 && debit < 0 && credit < 0) return null;
  return { date, description, amount, debit, credit };
}

// Pega o primeiro texto com letra; número de documento sozinho não é nome.
function pickDescription(fields: string[], columns: number[]): string {
  const values = columns.map((index) => (fields[index] ?? "").trim()).filter(Boolean);
  return values.find((value) => /\p{L}/u.test(value)) ?? values[0] ?? "";
}

export function parseCsv(text: string): ParsedStatementRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  // Some banks prepend a few lines of account info before the real header:
  // use the first line that actually looks like one.
  let headerIndex = -1;
  let delimiter = ",";
  let columns: CsvColumns | null = null;
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const candidateDelimiter = detectDelimiter(lines[i]);
    const found = findColumns(splitCsvLine(lines[i], candidateDelimiter));
    if (found) {
      headerIndex = i;
      delimiter = candidateDelimiter;
      columns = found;
      break;
    }
  }
  if (!columns || headerIndex < 0) {
    throw new StatementParseError(
      "Não reconheci as colunas do CSV. Ele precisa ter data, descrição e valor."
    );
  }

  const rows: ParsedStatementRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const fields = splitCsvLine(line, delimiter);
    const date = parseDate(fields[columns.date] ?? "");
    if (!date) continue;

    let amountCents: number | null = null;
    if (columns.amount >= 0) {
      amountCents = parseAmountToCents(fields[columns.amount] ?? "");
    } else {
      const debit = columns.debit >= 0 ? parseAmountToCents(fields[columns.debit] ?? "") : null;
      const credit = columns.credit >= 0 ? parseAmountToCents(fields[columns.credit] ?? "") : null;
      if (credit) amountCents = Math.abs(credit);
      else if (debit) amountCents = -Math.abs(debit);
    }
    if (amountCents === null || amountCents === 0) continue;

    rows.push({
      date,
      description: pickDescription(fields, columns.description) || "Lançamento importado",
      amountCents,
      externalId: null,
    });
  }
  return rows;
}

// Nome limpo pra mostrar e agrupar: sem número de documento, CPF/CNPJ
// mascarado, agência/conta, data e horário que os bancos grudam no nome.
// "PIX ENVIADO 0012345 MARIA SILVA - •••.123.456-•• - Agência: 1 Conta: 2-3"
// vira "PIX ENVIADO MARIA SILVA". Se sobrar nada, fica o original.
export function cleanStatementDescription(raw: string): string {
  const cleaned = raw
    .replace(/[•*x.\d]{3,}\.[•*x\d]{3}\.[•*x\d]{3}-[•*x\d]{2}/gi, " ")
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, " ")
    .replace(/\b(ag[eê]ncia|ag|conta|cc|c\/c|doc(?:to)?|documento|n[ºo°]|aut(?:enticac[aã]o)?)\.?\s*:?\s*[\d.\-\/]+/gi, " ")
    .replace(/\(\d{3,4}\)/g, " ")
    .replace(/\b\d{2}\/\d{2}(?:\/\d{2,4})?\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/(\s*-\s*)+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-:*]+|[\s\-:*]+$/g, "")
    .trim();
  return /\p{L}/u.test(cleaned) ? cleaned : raw.trim();
}
