import { GoogleGenerativeAI } from "@google/generative-ai";
import { StatementParseError, parseAmountToCents, parseDate, type ParsedStatementRow } from "./statementParser";

// Extrato em PDF (o que o app do banco gera em "Compartilhar extrato").
//
// 1. Abre o PDF (com a senha, se o banco protege) e remonta as linhas do texto.
// 2. Transforma as linhas em lançamentos: com a chave do Gemini, a IA só COPIA
//    data, nome, valor e os saldos do começo e do fim (não escolhe categoria
//    nenhuma); sem a chave, uma leitura por padrão de linha (data ... valor).
// 3. Confere: saldo inicial + soma das linhas = saldo final. Se não bater, a
//    tela avisa antes de importar.
//
// A senha só é usada pra abrir o arquivo; não é guardada em lugar nenhum.

export class PdfPasswordError extends StatementParseError {
  constructor(readonly reason: "needed" | "wrong") {
    super(reason === "needed" ? "Esse PDF tem senha. Digite a senha pra abrir." : "Senha do PDF incorreta.");
  }
}

export const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_FOR_AI = 60_000;

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

// Linhas do PDF na ordem de leitura: junta os pedaços de texto que estão na
// mesma altura da página, da esquerda pra direita.
export async function extractPdfLines(data: Uint8Array, password?: string): Promise<string[]> {
  if (data.byteLength > MAX_PDF_BYTES) throw new StatementParseError("Esse PDF é grande demais. Exporte um período menor.");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      password: password || undefined,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    const e = err as { name?: string; code?: number };
    if (e?.name === "PasswordException") throw new PdfPasswordError(e.code === 2 ? "wrong" : "needed");
    throw new StatementParseError("Não consegui abrir esse PDF. Confira se é o extrato do banco.");
  }

  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, 30); pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map<number, TextItem[]>();
    for (const raw of content.items as unknown[]) {
      const item = raw as TextItem;
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const row = rows.get(y) ?? [];
      row.push(item);
      rows.set(y, row);
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const items = rows.get(y)!.sort((a, b) => a.transform[4] - b.transform[4]);
      let line = "";
      let lastEnd = -Infinity;
      for (const item of items) {
        const x = item.transform[4];
        line += (line && x - lastEnd > 1.5 ? " " : "") + item.str;
        lastEnd = x + item.width;
      }
      const clean = line.replace(/\s+/g, " ").trim();
      if (clean) lines.push(clean);
    }
  }
  await doc.cleanup();
  if (lines.length === 0) {
    throw new StatementParseError("Esse PDF parece ser uma imagem (foto ou escaneado). Use o PDF que o app do banco gera.");
  }
  return lines;
}

export interface PdfStatement {
  rows: ParsedStatementRow[];
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  // true = bateu com o saldo do extrato; false = não bateu; null = o extrato
  // não mostra os dois saldos, não dá pra conferir.
  reconciled: boolean | null;
  // Quanto falta ou sobra quando não bate (saldo final esperado - lido).
  differenceCents: number;
  readBy: "ai" | "text";
  // Linhas do PDF com data e valor que não viraram lançamento: a "listinha
  // do que não conciliou" mostrada antes de importar.
  unreadLines: string[];
  // Layout reconhecido (leitura própria, conferida linha a linha).
  bank: Bank | null;
}

// Bancos com leitura própria. Os outros (Itaú, Santander, Inter...) passam
// pela leitura geral (data ... valor) ou pela IA.
export const BANKS = ["bradesco", "nubank", "bb", "caixa", "itau", "santander", "inter", "outro"] as const;
export type Bank = (typeof BANKS)[number];

type PdfRead = Omit<PdfStatement, "reconciled" | "differenceCents" | "readBy" | "unreadLines" | "bank">;

// ---- leitura sem IA: "dd/mm[/aaaa] descrição ... -1.234,56" -------------

const AMOUNT = String.raw`-?\(?(?:R\$\s?)?-?\d{1,3}(?:\.\d{3})*,\d{2}\)?(?:\s?[-DC])?`;
const LINE_RE = new RegExp(String.raw`^(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+(.+?)\s+(${AMOUNT})(?:\s+(${AMOUNT}))?$`);

function amountWithSuffix(raw: string): number | null {
  const trimmed = raw.trim();
  const debit = /\s?D$/.test(trimmed);
  const credit = /\s?C$/.test(trimmed);
  const cents = parseAmountToCents(trimmed.replace(/\s?[DC]$/, ""));
  if (cents === null) return null;
  if (debit) return -Math.abs(cents);
  if (credit) return Math.abs(cents);
  return cents;
}

function guessYear(lines: string[]): number {
  for (const line of lines.slice(0, 40)) {
    const m = line.match(/\b\d{2}\/\d{2}\/(\d{4})\b/) ?? line.match(/\b(20\d{2})\b/);
    if (m) return Number(m[1]);
  }
  return new Date().getFullYear();
}

function balanceFrom(lines: string[], words: RegExp): number | null {
  for (const line of lines) {
    if (!words.test(line.toLowerCase())) continue;
    const amounts = line.match(new RegExp(AMOUNT, "g"));
    if (amounts?.length) {
      const cents = amountWithSuffix(amounts[amounts.length - 1]);
      if (cents !== null) return cents;
    }
  }
  return null;
}

const UNDATED_RE = new RegExp(String.raw`^(.+?)\s+(${AMOUNT})(?:\s+(${AMOUNT}))?$`);
const LEADING_DATE_TIME = /^\d{2}\/\d{2}(?:\/\d{2,4})?\s*(?:\d{2}:\d{2}(?::\d{2})?)?\s*/;
// Cabeçalho, rodapé e totais: nunca são lançamento nem pedaço de nome.
const NOT_A_ROW = /saldo|total|limite|p[aá]gina|extrato|per[ií]odo|cliente|ouvidoria|sac\b|central de|^data\b|lan[cç]amentos? futuros/i;

// Lê "data nome valor". O nome de quem recebeu muitas vezes vem na linha de
// baixo (Bradesco, BB, Caixa: "PIX ENVIADO 123456 -50,00" + "MARIA SILVA"):
// essas linhas sem valor são juntadas ao lançamento de cima. Linha com valor
// e sem data é do mesmo dia da anterior.
export function readLinesWithoutAi(lines: string[]): PdfRead {
  const year = guessYear(lines);
  const rows: ParsedStatementRow[] = [];
  let lastDate: string | null = null;
  let last: ParsedStatementRow | null = null;
  let appended = 0;
  for (const line of lines) {
    if (/saldo/i.test(line)) {
      last = null;
      continue;
    }
    const dated = line.match(LINE_RE);
    const undated = !dated && lastDate && !NOT_A_ROW.test(line) && !LEADING_DATE_TIME.test(line) ? line.match(UNDATED_RE) : null;
    if (dated || undated) {
      let date: string | null = lastDate;
      let description: string;
      let rawAmount: string;
      if (dated) {
        const [, rawDate, desc, amount] = dated;
        date = parseDate(rawDate.length === 5 ? `${rawDate}/${year}` : rawDate);
        description = desc;
        rawAmount = amount;
      } else {
        [, description, rawAmount] = undated!;
        if (!/\p{L}/u.test(description)) continue;
      }
      const cents = amountWithSuffix(rawAmount);
      if (!date || cents === null || cents === 0) continue;
      lastDate = date;
      last = { date, description: description.trim(), amountCents: cents, externalId: null };
      rows.push(last);
      appended = 0;
      continue;
    }
    if (NOT_A_ROW.test(line)) {
      last = null;
      continue;
    }
    // Continuação do nome: tem letra, não tem valor, e no máximo duas linhas.
    const rest = line.replace(LEADING_DATE_TIME, "").trim();
    if (last && appended < 2 && /\p{L}/u.test(rest) && !new RegExp(AMOUNT).test(rest) && rest.length <= 80) {
      last.description = `${last.description} ${rest}`;
      appended++;
    }
  }
  return {
    rows,
    openingBalanceCents: balanceFrom(lines, /saldo (anterior|inicial)/),
    closingBalanceCents: balanceFrom(lines, /saldo (final|atual|do dia)/),
  };
}

// ---- extrato com coluna de saldo (Bradesco e parecidos) -----------------
//
// Cada lançamento ocupa até três linhas:
//   PIX ENVIADO                              <- histórico
//   01/09/2026 0831374 109,71 55.362,46      <- [data] docto valor saldo
//   DES: JOAO PESSOA SERVICO D 01/09         <- nome de quem recebeu/pagou
// Crédito e débito vêm os dois positivos: o sinal sai da diferença de saldo
// entre uma linha e a anterior. Linha em que o saldo não bate com o valor
// vai pra lista do "não conciliado".

const MONEY = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}`;
const VALUE_LINE = new RegExp(String.raw`^(?:(\d{2}\/\d{2}\/\d{4})\s+)?(.*?)\s*\b(\d{1,9})\s+(${MONEY})\s+(${MONEY})$`);
const BALANCE_ONLY = new RegExp(String.raw`^(?:(\d{2}\/\d{2}\/\d{4})\s+)?(?:cod\.?\s*lanc\.?|saldo).*?\s(${MONEY})$`, "i");
const PAGE_HEADER = /^(data:|nome:|extrato de:|data\s+hist)|folha:\s*\d+\s*\/\s*\d+/i;

const noDigits = (line: string) => line.replace(/\d/g, "");

// "PIX QR CODE DINAMICO" -> "Pix qr code dinamico" (tipo, em letra menor).
export function sentenceCase(text: string): string {
  const clean = text.replace(/\*+$/, "").trim().toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// "DES: Maria de Lourdes Silv 01/09" -> "Maria de Lourdes Silv".
function nameFrom(line: string): string {
  return line
    .replace(/^(des|rem|dest|fav|favorecido|pagador)\s*[:.]\s*/i, "")
    .replace(/\s+\d{2}\/\d{2}$/, "")
    .trim();
}

export interface BalanceColumnRead extends PdfRead {
  mismatched: string[];
}

export function readBalanceColumn(lines: string[]): BalanceColumnRead | null {
  // Cabeçalho que o banco repete em toda página: o que vem antes da linha
  // "Data Histórico ..." na primeira página.
  const firstColumns = lines.findIndex((line) => /^data\s+hist/i.test(line));
  const pageHeader = new Set(lines.slice(0, Math.max(firstColumns + 1, 0)).map(noDigits));

  const rows: ParsedStatementRow[] = [];
  const mismatched: string[] = [];
  let opening: number | null = null;
  let balance: number | null = null;
  let date: string | null = null;
  let pending: string[] = [];
  let last: ParsedStatementRow | null = null;

  // As linhas de baixo são o nome (DES:/REM:/loja). O nome vira a descrição e
  // o histórico ("PIX ENVIADO") vira o tipo. A data do DES:/REM: é o dia em
  // que o Pix foi feito (o lançamento pode cair no dia útil seguinte).
  const attachName = (texts: string[]) => {
    if (!last) return;
    const useful = texts.filter((t) => !/^(bco|age|cta)\s*:/i.test(t));
    const name = useful.map(nameFrom).filter(Boolean).join(" ");
    if (name) {
      last.kind = sentenceCase(last.description);
      last.description = name;
    }
    const when = useful.map((t) => t.match(/\s(\d{2})\/(\d{2})$/)).find(Boolean);
    if (when) {
      const [year, month] = last.date.split("-").map(Number);
      const m = Number(when[2]);
      const y = m > month ? year - 1 : year;
      const date = parseDate(`${when[1]}/${when[2]}/${y}`);
      if (date && date <= last.date) last.date = date;
    }
  };

  for (const line of lines) {
    if (pageHeader.has(noDigits(line)) || PAGE_HEADER.test(line) || /^total\b/i.test(line)) continue;

    const balanceOnly = line.match(BALANCE_ONLY);
    const value = !balanceOnly || /\d+,\d{2}\s+-?[\d.]+,\d{2}$/.test(line) ? line.match(VALUE_LINE) : null;
    if (!value && balanceOnly) {
      if (balanceOnly[1]) date = parseDate(balanceOnly[1]);
      const cents = parseAmountToCents(balanceOnly[2]);
      if (cents !== null) {
        // "Últimos Lançamentos" recomeça de um saldo novo: o que aconteceu
        // no meio não vem no PDF. Conta como novo ponto de partida.
        if (opening !== null && balance !== null) opening += cents - balance;
        balance = cents;
        if (opening === null) opening = cents;
      }
      attachName(pending);
      pending = [];
      last = null;
      continue;
    }
    if (!value) {
      pending.push(line);
      continue;
    }

    const [, rawDate, inline, , rawAmount, rawBalance] = value;
    if (rawDate) date = parseDate(rawDate);
    const amount = parseAmountToCents(rawAmount);
    const newBalance = parseAmountToCents(rawBalance);
    if (amount === null || newBalance === null || !date) {
      pending = [];
      continue;
    }
    // Linhas soltas entre dois lançamentos: se esta linha já traz o próprio
    // histórico, todas eram o nome do anterior; senão a última é o histórico
    // desta e as outras, o nome do anterior.
    const text = inline.trim();
    const history = text || pending.pop() || "";
    attachName(pending);
    pending = [];

    if (/cod\.?\s*lanc/i.test(history) || amount === 0) {
      if (opening !== null && balance !== null) opening += newBalance - balance;
      balance = newBalance;
      if (opening === null) opening = newBalance;
      last = null;
      continue;
    }

    let cents = -Math.abs(amount);
    if (balance !== null) {
      const delta = newBalance - balance;
      if (delta === Math.abs(amount)) cents = Math.abs(amount);
      else if (delta !== -Math.abs(amount)) mismatched.push(line);
    } else if (opening === null) {
      opening = newBalance + Math.abs(amount); // melhor palpite: foi saída
    }
    balance = newBalance;
    last = { date, description: (history || "Lançamento").replace(/\*+$/, "").trim(), amountCents: cents, externalId: null, kind: null };
    rows.push(last);
  }
  attachName(pending);

  if (rows.length < 3) return null;
  return { rows, openingBalanceCents: opening, closingBalanceCents: balance, mismatched };
}

// ---- extrato do Nubank (conta) ------------------------------------------
//
// Conferido com extrato real (texto por posição, igual ao nosso leitor):
//   01 JUN 2026 Total de entradas + 50,00
//   Transferência Recebida Joaninha Ferreira de Souza - •••.111.222-•• - NU 50,00
//   PAGAMENTOS - IP (0260) Agência: 1 Conta:
//   11122233-4
// O valor vem na PRIMEIRA linha, sem sinal; as linhas de baixo continuam o
// nome. Entrada ou saída sai da seção (Total de entradas / Total de saídas),
// e o total de cada seção confere as linhas daquele dia. O cabeçalho da
// página (nome, CPF, período) se repete no meio e é ignorado.

const MONTHS: Record<string, string> = { JAN: "01", FEV: "02", MAR: "03", ABR: "04", MAI: "05", JUN: "06", JUL: "07", AGO: "08", SET: "09", OUT: "10", NOV: "11", DEZ: "12" };
const NU_DAY = /^(\d{2}) (JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ) (\d{4})\b\s*(.*)$/i;
const NU_SECTION = /^total de (entradas|sa[ií]das)\s*[+\-−]?\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})$/i;
const NU_ROW = /^(.*?\S)\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})$/;
const NU_NOISE =
  /^(tem alguma d[uú]vida|metropolitanas|caso a solu|dispon[ií]veis em|extrato gerado|n[aã]o nos responsabilizamos|asseguramos|o saldo l[ií]quido|nu (pagamentos|financeira)|investimento pagamento|cnpj|valores em r\$|movimenta[cç][oõ]es$|cpf\b|\d+ de \d+$|\d{2} de [a-zç]+ de \d{4} a )/i;
const NU_KINDS = [
  /^transfer[eê]ncia (?:enviada|recebida)(?: pelo pix)?/i,
  /^transfer[eê]ncia de saldo \S+/i,
  /^reembolso (?:recebido|enviado) pelo pix/i,
  /^compra no d[eé]bito(?: via nupay)?/i,
  /^pagamento de (?:fatura|boleto efetuado|boleto)/i,
  /^dep[oó]sito recebido por boleto/i,
  /^(?:aplica[cç][aã]o|resgate)(?: rdb| nuinvest| caixinha)?/i,
  /^pix no cr[eé]dito/i,
  /^estorno(?: de)?/i,
  /^d[eé]bito em conta/i,
];

// "Transferência enviada pelo Pix MARIA SILVA - •••.123.456-•• - NU PAGAMENTOS"
// -> tipo "Transferência enviada pelo Pix", nome "MARIA SILVA".
export function splitNubankDescription(text: string): { kind: string | null; name: string } {
  const cut = (rest: string) =>
    rest
      .split(/\s+-\s+/)[0]
      .replace(/\s*\((?:transfer[eê]ncia|pix)[^)]*\)?\s*$/i, "")
      .trim();
  // Pix no Crédito: as duas colunas quebram linha juntas e o texto sai
  // misturado ("Valor adicionado na conta por cartão Valor adicionado para
  // Pix no Crédito de crédito").
  if (/^valor adicionado na conta por/i.test(text)) return { kind: "Valor adicionado por cartão de crédito", name: "Pix no Crédito" };
  for (const re of NU_KINDS) {
    const m = text.match(re);
    if (!m) continue;
    const name = cut(text.slice(m[0].length));
    return name ? { kind: m[0].trim(), name } : { kind: null, name: m[0].trim() };
  }
  return { kind: null, name: cut(text) || text.trim() };
}

export interface SectionRead extends PdfRead {
  mismatched: string[];
}

export function readNubank(lines: string[]): SectionRead | null {
  if (!lines.some((line) => NU_DAY.test(line)) || !lines.some((line) => /total de (entradas|sa[ií]das)/i.test(line))) return null;
  // Cabeçalho repetido em toda página: as linhas antes do quadro-resumo.
  const firstSummary = lines.findIndex((line) => /^saldo inicial/i.test(line));
  const pageHeader = new Set(lines.slice(0, Math.max(firstSummary, 0)).map((line) => line.replace(/\d/g, "")));

  const rows: ParsedStatementRow[] = [];
  const texts: string[] = [];
  const mismatched: string[] = [];
  let date: string | null = null;
  let sign = 0;
  let last = -1;
  let appended = 0;
  let section: { label: string; expected: number; sum: number } | null = null;

  const closeSection = () => {
    if (section && section.sum !== section.expected) {
      mismatched.push(`${section.label}: o extrato diz ${fromCentsBr(section.expected)}, as linhas somam ${fromCentsBr(section.sum)}`);
    }
    section = null;
  };

  for (const raw of lines) {
    let line = raw;
    if (pageHeader.has(line.replace(/\d/g, "")) || NU_NOISE.test(line)) {
      last = -1;
      continue;
    }
    const day = line.match(NU_DAY);
    if (day) {
      date = `${day[3]}-${MONTHS[day[2].toUpperCase()]}-${day[1]}`;
      line = day[4].trim();
      last = -1;
      if (!line) continue;
    }
    const sec = line.match(NU_SECTION);
    // O resumo do topo também tem "Total de entradas"; só vale depois de um dia.
    if (sec && date) {
      closeSection();
      sign = /entrada/i.test(sec[1]) ? 1 : -1;
      section = { label: `${date.split("-").reverse().join("/")} ${sign > 0 ? "entradas" : "saídas"}`, expected: parseAmountToCents(sec[2]) ?? 0, sum: 0 };
      last = -1;
      continue;
    }
    if (/^saldo|^rendimento|^total de/i.test(line)) {
      last = -1;
      continue;
    }
    if (!sign || !date) continue;
    const row = line.match(NU_ROW);
    if (row && /\p{L}/u.test(row[1])) {
      const cents = parseAmountToCents(row[2]);
      if (!cents) continue;
      texts.push(row[1]);
      rows.push({ date, description: row[1], kind: null, amountCents: sign * Math.abs(cents), externalId: null });
      if (section) section.sum += Math.abs(cents);
      last = rows.length - 1;
      appended = 0;
      continue;
    }
    // Continuação do nome do lançamento de cima.
    if (last >= 0 && appended < 3) {
      texts[last] = `${texts[last]} ${line}`;
      appended++;
    }
  }
  closeSection();
  if (rows.length === 0) return null;
  rows.forEach((row, index) => {
    const { kind, name } = splitNubankDescription(texts[index].replace(/\s+/g, " ").trim());
    row.kind = kind;
    row.description = name;
  });
  return {
    rows,
    openingBalanceCents: balanceFrom(lines, /saldo inicial/),
    closingBalanceCents: balanceFrom(lines, /saldo final/),
    mismatched,
  };
}

// ---- Banco do Brasil ------------------------------------------------------
//
// Conferido com extrato real:
//   01/08/2023 0000 13105 144 Pix - Enviado 80.101 2.001,00 D
//   01/08 11:34 FULANO DE TAL EXEMPLO
//   08/08/2023 0000 13105 393 TED Transf.Eletr.Disponiv 80.802 2.001,00 D
//   010 0050 11122233344 CARLOS EXEMPLO SIL
// Histórico, documento, valor e D/C na linha; o nome na linha de baixo.

const BB_ROW = new RegExp(
  String.raw`^(\d{2}\/\d{2}\/\d{4})\s+\d{4}\s+\d{5}\s+\d{3}\s+(.+?)\s+(?:([\d.]{3,})\s+)?(\d{1,3}(?:\.\d{3})*,\d{2})\s+([DC])(?:\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+[DC])?$`
);

export function readBancoDoBrasil(lines: string[]): SectionRead | null {
  if (lines.filter((line) => BB_ROW.test(line)).length < 3) return null;
  const rows: ParsedStatementRow[] = [];
  let opening: number | null = null;
  let closing: number | null = null;
  let last: ParsedStatementRow | null = null;
  for (const line of lines) {
    const m = line.match(BB_ROW);
    if (m) {
      const [, rawDate, history, , rawAmount, dc] = m;
      const cents = (parseAmountToCents(rawAmount) ?? 0) * (dc === "D" ? -1 : 1);
      if (/saldo|s a l d o/i.test(history)) {
        if (opening === null) opening = cents;
        else closing = cents;
        last = null;
        continue;
      }
      const date = parseDate(rawDate);
      if (!date || cents === 0) continue;
      last = { date, description: history.trim(), kind: null, amountCents: cents, externalId: null };
      rows.push(last);
      continue;
    }
    if (!last) continue;
    // Linha de baixo: "01/08 11:34 NOME" ou "010 0050 11122233344 NOME".
    const time = line.match(/^\d{2}\/\d{2}\s+(\d{2}:\d{2})\s/);
    if (time) last.time = time[1];
    const name = line.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/, "").replace(/^(?:\d+\s+)+/, "").trim();
    if (name && /\p{L}/u.test(name) && !/^(tar\. agrupadas|cobran[cç]a referente|-{3,})/i.test(name)) {
      last.kind = last.description;
      last.description = name;
    }
    last = null;
  }
  if (rows.length === 0) return null;
  return { rows, openingBalanceCents: opening, closingBalanceCents: closing, mismatched: [] };
}

// ---- Caixa ----------------------------------------------------------------
//
// Layout do Gerenciador Caixa (visto num conversor aberto; ainda sem extrato
// real nosso pra conferir):
//   PIX ENVIADO
//   02/09/2026
//   000123 MARIA SILVA R$ 50,00 R$ 950,00 D

const CAIXA_ROW = /^(\S+)\s+(.+?)\s+R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s+R\$\s*-?(\d{1,3}(?:\.\d{3})*,\d{2})\s+([CD])$/;

export function readCaixa(lines: string[]): SectionRead | null {
  const rows: ParsedStatementRow[] = [];
  let opening: number | null = null;
  let closing: number | null = null;
  for (let i = 2; i < lines.length; i++) {
    const m = lines[i].match(CAIXA_ROW);
    const date = m && /^\d{2}\/\d{2}\/\d{4}$/.test(lines[i - 1]) ? parseDate(lines[i - 1]) : null;
    if (!m || !date) continue;
    const history = lines[i - 2].trim();
    const cents = (parseAmountToCents(m[3]) ?? 0) * (m[5] === "D" ? -1 : 1);
    if (/saldo/i.test(history)) {
      if (opening === null) opening = parseAmountToCents(m[4]);
      closing = parseAmountToCents(m[4]);
      continue;
    }
    if (!cents) continue;
    rows.push({ date, description: m[2].trim(), kind: sentenceCase(history), amountCents: cents, externalId: null });
  }
  if (rows.length < 3) return null;
  return { rows, openingBalanceCents: opening, closingBalanceCents: closing, mismatched: [] };
}

function fromCentsBr(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

// Linhas que têm data e valor mas não viraram lançamento (nem são saldo):
// o que pode ter ficado de fora quando a soma não bate.
export function findUnreadLines(lines: string[], rows: ParsedStatementRow[]): string[] {
  const left = new Map<number, number>();
  for (const row of rows) left.set(Math.abs(row.amountCents), (left.get(Math.abs(row.amountCents)) ?? 0) + 1);
  const unread: string[] = [];
  const amountRe = new RegExp(AMOUNT, "g");
  for (const line of lines) {
    if (/saldo|total/i.test(line) || !/^\d{2}\/\d{2}/.test(line)) continue;
    const amounts = line.match(amountRe);
    if (!amounts) continue;
    // O primeiro valor da linha é o lançamento; o segundo, quando tem, é o saldo.
    const cents = amountWithSuffix(amounts[0]);
    if (cents === null || cents === 0) continue;
    const key = Math.abs(cents);
    const count = left.get(key) ?? 0;
    if (count > 0) left.set(key, count - 1);
    else unread.push(line);
  }
  return unread.slice(0, 30);
}

// ---- leitura com IA (só copiar, nunca classificar) ----------------------

interface AiReply {
  openingBalance?: number | null;
  closingBalance?: number | null;
  rows?: { date?: string; description?: string; amount?: number }[];
}

async function readLinesWithAi(lines: string[], apiKey: string): Promise<PdfRead> {
  const text = lines.join("\n").slice(0, MAX_TEXT_FOR_AI);
  const prompt = `Você recebe o texto de um extrato bancário brasileiro. Sua única tarefa é COPIAR os lançamentos, sem interpretar nem classificar.

Responda só com JSON neste formato:
{"openingBalance": número ou null, "closingBalance": número ou null, "rows": [{"date": "AAAA-MM-DD", "description": "texto exatamente como está no extrato", "amount": número}]}

Regras:
- amount negativo = dinheiro que saiu da conta; positivo = entrou.
- description = o que aconteceu + o NOME de quem recebeu ou pagou (loja, pessoa, empresa), com as palavras do extrato (ex.: "PAO DE ACUCAR", "PIX ENVIADO MARIA SILVA", "TED RECEBIDA ACME LTDA"). Não traduza, não resuma, não invente categoria.
- Muitos bancos põem o nome na linha de baixo do lançamento: junte as duas.
- Nunca use só número como descrição: tire número de documento, CPF/CNPJ, agência, conta, horário e código de autenticação.
- Não inclua linhas de saldo (saldo anterior, saldo do dia, saldo final) em rows.
- openingBalance = saldo no começo do período; closingBalance = saldo no fim. null se o extrato não mostrar.
- Se a data não tiver ano, use o ano do período do extrato.

Extrato:
${text}`;
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });
  const result = await model.generateContent(prompt);
  let reply: AiReply;
  try {
    reply = JSON.parse(result.response.text()) as AiReply;
  } catch {
    throw new StatementParseError("Não consegui ler os lançamentos desse PDF. Tente de novo ou use OFX/CSV.");
  }
  const rows: ParsedStatementRow[] = [];
  for (const row of reply.rows ?? []) {
    const date = typeof row.date === "string" ? parseDate(row.date) : null;
    const description = typeof row.description === "string" ? row.description.trim() : "";
    if (!date || !description || typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount === 0) continue;
    rows.push({ date, description: description.slice(0, 120), amountCents: Math.round(row.amount * 100), externalId: null });
  }
  const toCents = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
  return { rows, openingBalanceCents: toCents(reply.openingBalance), closingBalanceCents: toCents(reply.closingBalance) };
}

export function reconcile(read: PdfRead) {
  if (read.openingBalanceCents === null || read.closingBalanceCents === null) return { reconciled: null, differenceCents: 0 };
  const sum = read.rows.reduce((total, row) => total + row.amountCents, 0);
  const difference = read.closingBalanceCents - (read.openingBalanceCents + sum);
  return { reconciled: Math.abs(difference) <= 1, differenceCents: difference };
}

// Banco escolhido na tela primeiro; se o PDF não tiver a cara dele, tenta os
// outros leitores e, por último, a leitura geral/IA. `bank` no resultado diz
// qual layout foi reconhecido de fato (a tela avisa se não for o escolhido).
export async function parsePdfStatement(data: Uint8Array, password?: string, chosen?: Bank | null): Promise<PdfStatement> {
  const lines = await extractPdfLines(data, password);

  const readers: { bank: Bank; read: () => SectionRead | BalanceColumnRead | null }[] = [
    { bank: "bradesco", read: () => readBalanceColumn(lines) },
    { bank: "bb", read: () => readBancoDoBrasil(lines) },
    { bank: "nubank", read: () => readNubank(lines) },
    { bank: "caixa", read: () => readCaixa(lines) },
  ];
  readers.sort((a, b) => Number(b.bank === chosen) - Number(a.bank === chosen));
  for (const reader of readers) {
    const found = reader.read();
    if (!found) continue;
    const { mismatched, ...read } = found;
    const check = reconcile(read);
    // Leitura por coluna de saldo que não bate e não apontou a linha: deixa
    // pros outros leitores.
    if (reader.bank === "bradesco" && check.reconciled === false && mismatched.length === 0) continue;
    const reconciled = check.reconciled ?? (reader.bank === "nubank" ? mismatched.length === 0 : null);
    const bank = reader.bank === "bradesco" && !lines.some((line) => /bradesco/i.test(line)) ? null : reader.bank;
    return { ...read, ...check, reconciled, readBy: "text", unreadLines: mismatched.slice(0, 30), bank };
  }

  // Itaú, Santander, Inter e o resto: "data descrição valor". No Itaú a
  // aplicação automática do dia (Aplic Aut Mais) não é gasto.
  const general = lines.filter((line) => !/aplic aut mais/i.test(line));
  const apiKey = process.env.GEMINI_API_KEY;
  let read = readLinesWithoutAi(general);
  let readBy: PdfStatement["readBy"] = "text";
  if (apiKey) {
    try {
      const byAi = await readLinesWithAi(general, apiKey);
      // Fica com a leitura da IA se ela achou lançamentos; senão, a por padrão.
      if (byAi.rows.length > 0) {
        read = byAi;
        readBy = "ai";
      }
    } catch (err) {
      if (err instanceof StatementParseError && read.rows.length === 0) throw err;
    }
  }
  if (read.rows.length === 0) {
    throw new StatementParseError("Não encontrei lançamentos nesse PDF. Se o banco tiver, use a opção OFX ou CSV.");
  }
  return { ...read, ...reconcile(read), readBy, unreadLines: findUnreadLines(general, read.rows), bank: null };
}
