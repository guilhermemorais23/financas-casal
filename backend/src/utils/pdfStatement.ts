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
}

type PdfRead = Omit<PdfStatement, "reconciled" | "differenceCents" | "readBy" | "unreadLines">;

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

export async function parsePdfStatement(data: Uint8Array, password?: string): Promise<PdfStatement> {
  const lines = await extractPdfLines(data, password);
  const apiKey = process.env.GEMINI_API_KEY;
  let read = readLinesWithoutAi(lines);
  let readBy: PdfStatement["readBy"] = "text";
  if (apiKey) {
    try {
      const byAi = await readLinesWithAi(lines, apiKey);
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
  return { ...read, ...reconcile(read), readBy, unreadLines: findUnreadLines(lines, read.rows) };
}
