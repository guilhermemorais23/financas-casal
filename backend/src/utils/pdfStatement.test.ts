import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PdfPasswordError,
  findUnreadLines,
  parsePdfStatement,
  readBalanceColumn,
  readLinesWithoutAi,
  readNubank,
  reconcile,
  splitNubankDescription,
} from "./pdfStatement";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "__fixtures__", name)));

describe("parsePdfStatement (sem IA)", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  });

  it("lê os lançamentos e confere com o saldo do extrato", async () => {
    const result = await parsePdfStatement(fixture("extrato-exemplo.pdf"));
    expect(result.readBy).toBe("text");
    expect(result.rows.length).toBe(7);
    expect(result.reconciled).toBe(true);
    expect(result.rows.some((row) => row.amountCents > 0)).toBe(true);
    expect(result.rows.some((row) => row.amountCents < 0)).toBe(true);
  });

  it("pede a senha e avisa quando está errada", async () => {
    await expect(parsePdfStatement(fixture("extrato-com-senha.pdf"))).rejects.toMatchObject({ reason: "needed" });
    await expect(parsePdfStatement(fixture("extrato-com-senha.pdf"), "errada")).rejects.toBeInstanceOf(PdfPasswordError);
    await expect(parsePdfStatement(fixture("extrato-com-senha.pdf"), "errada")).rejects.toMatchObject({ reason: "wrong" });
    const opened = await parsePdfStatement(fixture("extrato-com-senha.pdf"), "12345");
    expect(opened.rows.length).toBeGreaterThan(0);
  });
});

describe("readLinesWithoutAi / reconcile", () => {
  it("entende D/C, ano do período e saldos", () => {
    const read = readLinesWithoutAi([
      "Extrato de 01/09/2026 a 30/09/2026",
      "Saldo anterior 1.000,00",
      "02/09 PAO DE ACUCAR 1204 150,00 D",
      "05/09 PIX RECEBIDO ANA 200,00 C",
      "Saldo final 1.050,00",
    ]);
    expect(read.rows).toEqual([
      { date: "2026-09-02", description: "PAO DE ACUCAR 1204", amountCents: -15000, externalId: null },
      { date: "2026-09-05", description: "PIX RECEBIDO ANA", amountCents: 20000, externalId: null },
    ]);
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
    expect(reconcile({ ...read, closingBalanceCents: 100_000 })).toEqual({ reconciled: false, differenceCents: -5000 });
    expect(reconcile({ ...read, openingBalanceCents: null })).toEqual({ reconciled: null, differenceCents: 0 });
  });
});

describe("readLinesWithoutAi: nome na linha de baixo", () => {
  it("junta o nome de quem recebeu e usa o dia anterior nas linhas sem data", () => {
    const read = readLinesWithoutAi([
      "Extrato de 01/09/2026 a 30/09/2026",
      "Data Histórico Docto. Crédito Débito Saldo",
      "01/09/2026 SALDO ANTERIOR 1.000,00",
      "02/09/2026 PIX ENVIADO 1234567 -50,00 950,00",
      "DES: MARIA SILVA 02/09",
      "PIX ENVIADO 7654321 -30,00 920,00",
      "02/09 14:31 JOAO PEREIRA",
      "Total do dia -80,00",
      "03/09/2026 COMPRA ELO 0001 PADARIA SOL -12,00 908,00",
    ]);
    expect(read.rows.map((row) => [row.date, row.description, row.amountCents])).toEqual([
      ["2026-09-02", "PIX ENVIADO 1234567 DES: MARIA SILVA 02/09", -5000],
      ["2026-09-02", "PIX ENVIADO 7654321 JOAO PEREIRA", -3000],
      ["2026-09-03", "COMPRA ELO 0001 PADARIA SOL", -1200],
    ]);
  });

  it("lista as linhas com data e valor que não viraram lançamento", () => {
    const lines = ["02/09 MERCADO -10,00", "03/09 12345 67890 -20,00", "04/09 SALDO DO DIA 100,00"];
    expect(findUnreadLines(lines, [{ date: "2026-09-02", description: "MERCADO", amountCents: -1000, externalId: null }])).toEqual([
      "03/09 12345 67890 -20,00",
    ]);
  });
});

describe("readBalanceColumn (layout do Bradesco Celular)", () => {
  const page = (n: number) => [
    "Bradesco Celular",
    "Data: 25/09/2026 - 17h22",
    "Nome: FULANO DE TAL",
    `Extrato de: Agência: 1 | Conta: 1234-5 | Movimentação entre: 01/09/2026 e 25/09/2026 Folha: ${n}/2`,
    "Data Histórico Docto. Crédito (R$) Débito (R$) Saldo (R$)",
  ];
  const lines = [
    ...page(1),
    "31/08/2026 COD. LANC. 0 0,00 1.000,00",
    "PIX RECEBIDO",
    "01/09/2026 1642458 50,00 1.050,00",
    "REM: Maria de Lourdes Silv 01/09",
    "RENTAB.INVEST FACILCRED* 0935700 0,22 1.050,22",
    "COMPRA CARTAO VISA",
    "0501620 26,06 1.024,16",
    "REDE COMPRAS AEROCLU",
    ...page(2),
    "PIX ENVIADO",
    "02/09/2026 0831374 100,00 924,16",
    "DES: JOAO PESSOA SERVICO D 01/09",
    "Total 50,22 126,06 924,16",
    "02/09/2026 COD. LANC. 0 924,16",
    "PIX QR CODE DINAMICO",
    "03/09/2026 1048143 24,16 900,00",
    "DES: REDE BOM COMERCIO LTD 03/09",
    "Total 0,00 24,16 900,00",
  ];

  it("nome vira a descrição, histórico vira o tipo, data do Pix, e linha de saldo nunca entra", () => {
    const read = readBalanceColumn(lines)!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-09-01", "Pix recebido", "Maria de Lourdes Silv", 5000],
      ["2026-09-01", null, "RENTAB.INVEST FACILCRED", 22],
      ["2026-09-01", "Compra cartao visa", "REDE COMPRAS AEROCLU", -2606],
      // Lançado dia 02, mas o Pix foi feito dia 01 (data do DES:).
      ["2026-09-01", "Pix enviado", "JOAO PESSOA SERVICO D", -10000],
      ["2026-09-03", "Pix qr code dinamico", "REDE BOM COMERCIO LTD", -2416],
    ]);
    expect(read.openingBalanceCents).toBe(100000);
    expect(read.closingBalanceCents).toBe(90000);
    expect(read.mismatched).toEqual([]);
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
  });

  it("põe na lista do não conciliado a linha em que o saldo não bate (linha faltando)", () => {
    const missing = lines.filter((line) => !line.startsWith("RENTAB"));
    expect(readBalanceColumn(missing)!.mismatched).toEqual(["0501620 26,06 1.024,16"]);
  });
});

describe("readNubank", () => {
  const lines = [
    "Extrato de conta",
    "Saldo inicial 1.000,00",
    "Total de entradas + 1.500,00",
    "Total de saídas - 250,00",
    "Saldo final do período 2.250,00",
    "Movimentações",
    "01 SET 2026 Total de entradas + 1.500,00",
    "Transferência recebida pelo Pix JOAO DA SILVA - •••.123.456-•• - ITAÚ",
    "UNIBANCO S.A. (0341) Agência: 1234 Conta: 12345-6 1.500,00",
    "Total de saídas - 200,00",
    "Transferência enviada pelo Pix MARIA DE LOURDES SILVA - •••.654.321-•• - NU PAGAMENTOS - IP (0260) 150,00",
    "Compra no débito PADARIA SOL 50,00",
    "Tem alguma dúvida? Mande uma mensagem para nosso time de atendimento.",
    "02 SET 2026 Total de saídas - 50,00",
    "Pagamento de fatura 50,00",
  ];

  it("tira o sinal da seção, separa tipo e nome inteiro e confere o total do dia", () => {
    const read = readNubank(lines)!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-09-01", "Transferência recebida pelo Pix", "JOAO DA SILVA", 150000],
      ["2026-09-01", "Transferência enviada pelo Pix", "MARIA DE LOURDES SILVA", -15000],
      ["2026-09-01", "Compra no débito", "PADARIA SOL", -5000],
      ["2026-09-02", null, "Pagamento de fatura", -5000],
    ]);
    expect(read.mismatched).toEqual([]);
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
  });

  it("avisa quando o total do dia não bate", () => {
    const missing = lines.filter((line) => !line.startsWith("Compra no débito"));
    expect(readNubank(missing)!.mismatched).toHaveLength(1);
  });

  it("não é Nubank sem os cabeçalhos de dia", () => {
    expect(readNubank(["02/09 MERCADO -10,00"])).toBeNull();
    expect(splitNubankDescription("Compra no débito via NuPay iFood - x")).toEqual({ kind: "Compra no débito via NuPay", name: "iFood" });
  });
});
