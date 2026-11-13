import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PdfPasswordError,
  findUnreadLines,
  parsePdfStatement,
  readBalanceColumn,
  readLinesWithoutAi,
  readBancoDoBrasil,
  readCaixa,
  readInter,
  readNubank,
  reconcile,
  splitNubankDescription,
} from "./pdfStatement";
import { cleanStatementDescription } from "./statementParser";

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

  it("'Últimos Lançamentos' recomeça de outro saldo sem acusar diferença", () => {
    const withGap = [...lines, "Folha: 3/3", "10/09/2026 COD. LANC. 0 800,00", "RENDIMENTOS", "11/09/2026 1206715 1,00 801,00", "POUP FACIL"];
    const read = readBalanceColumn(withGap)!;
    expect(read.rows.at(-1)).toMatchObject({ date: "2026-09-11", description: "POUP FACIL", kind: "Rendimentos", amountCents: 100 });
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
  });

  it("põe na lista do não conciliado a linha em que o saldo não bate (linha faltando)", () => {
    const missing = lines.filter((line) => !line.startsWith("RENTAB"));
    expect(readBalanceColumn(missing)!.mismatched).toEqual(["0501620 26,06 1.024,16"]);
  });
});

describe("readNubank (layout conferido com extrato real)", () => {
  const lines = [
    "FULANA DE TAL",
    "CPF •••.123.456-•• Agência 0001 Conta",
    "01 DE SETEMBRO DE 2026 a 30 DE SETEMBRO DE 2026 VALORES EM R$",
    "Saldo inicial 1.000,00",
    "Total de entradas +1.550,00",
    "Total de saídas -250,00",
    "Saldo final do período 2.300,00",
    "Movimentações",
    "01 SET 2026 Total de entradas + 1.500,00",
    "Transferência recebida pelo Pix JOAO DA SILVA - •••.123.456-•• - ITAÚ 1.500,00",
    "UNIBANCO S.A. (0341) Agência: 1234 Conta: 12345-6",
    "Total de saídas - 200,00",
    "Transferência enviada pelo Pix IFOOD COM AGENCIA DE RESTAURANTES ONLINE 150,00",
    "S A - 14.380.200/0001-21 - ITAÚ UNIBANCO S.A.",
    "Tem alguma dúvida? Mande uma mensagem para nosso time de atendimento.",
    "1 de 2",
    "FULANA DE TAL",
    "CPF •••.123.456-•• Agência 0001 Conta",
    "01 DE SETEMBRO DE 2026 a 30 DE SETEMBRO DE 2026 VALORES EM R$",
    "Compra no débito PADARIA SOL 50,00",
    "02 SET 2026 Total de entradas + 50,00",
    "Valor adicionado na conta por cartão Valor adicionado para Pix no Crédito 50,00",
    "de crédito",
    "Total de saídas - 50,00",
    "Pagamento de fatura 50,00",
  ];

  it("valor na primeira linha, nome continua embaixo, sinal pela seção, cabeçalho ignorado", () => {
    const read = readNubank(lines)!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-09-01", "Transferência recebida pelo Pix", "JOAO DA SILVA", 150000],
      ["2026-09-01", "Transferência enviada pelo Pix", "IFOOD COM AGENCIA DE RESTAURANTES ONLINE S A", -15000],
      ["2026-09-01", "Compra no débito", "PADARIA SOL", -5000],
      ["2026-09-02", "Valor adicionado por cartão de crédito", "Pix no Crédito", 5000],
      ["2026-09-02", null, "Pagamento de fatura", -5000],
    ]);
    expect(read.mismatched).toEqual([]);
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
  });

  it("avisa quando o total do dia não bate", () => {
    const missing = lines.filter((line) => !line.startsWith("Compra no débito"));
    expect(readNubank(missing)!.mismatched).toEqual(["01/09/2026 saídas: o extrato diz R$ 200,00, as linhas somam R$ 150,00"]);
  });

  it("não é Nubank sem os cabeçalhos de dia", () => {
    expect(readNubank(["02/09 MERCADO -10,00"])).toBeNull();
    expect(splitNubankDescription("Compra no débito via NuPay iFood - x")).toEqual({ kind: "Compra no débito via NuPay", name: "iFood" });
    expect(splitNubankDescription("Transferência enviada pelo Pix Luciana Silva (Transferência enviada)")).toEqual({
      kind: "Transferência enviada pelo Pix",
      name: "Luciana Silva",
    });
  });
});

describe("readBancoDoBrasil (layout conferido com extrato real)", () => {
  it("histórico vira tipo, nome da linha de baixo, D/C dá o sinal, saldo não entra", () => {
    const read = readBancoDoBrasil([
      "Dt. balancete Dt. movimento Ag. origem Lote Histórico Documento Valor R$ Saldo",
      "31/07/2026 0000 00000 000 Saldo Anterior 100,00 C",
      "01/08/2026 0000 13105 144 Pix - Enviado 80.101 20,00 D",
      "01/08 11:34 FULANO DE TAL EXEMPLO",
      "01/08/2026 0000 13113 258 Tarifa Pix Enviado 872.131.200.057.912 2,00 D",
      "Tar. agrupadas - ocorrencia 31/07/2026",
      "08/08/2026 0000 13105 393 TED Transf.Eletr.Disponiv 80.802 30,00 D",
      "010 0050 11122233344 CARLOS EXEMPLO SIL",
      "18/08/2026 9999 99015 870 Transferência recebida 551.493.000.002.021 52,00 C 100,00 C",
      "18/08 08:35 PREFEITURA MUNICIPAL",
      "31/08/2026 0000 00000 999 S A L D O 100,00 C",
    ])!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-08-01", "Pix - Enviado", "FULANO DE TAL EXEMPLO", -2000],
      ["2026-08-01", null, "Tarifa Pix Enviado", -200],
      ["2026-08-08", "TED Transf.Eletr.Disponiv", "CARLOS EXEMPLO SIL", -3000],
      ["2026-08-18", "Transferência recebida", "PREFEITURA MUNICIPAL", 5200],
    ]);
    expect(read.rows.map((row) => row.time ?? null)).toEqual(["11:34", null, null, "08:35"]);
    expect(reconcile(read)).toEqual({ reconciled: true, differenceCents: 0 });
  });
});

describe("readCaixa", () => {
  it("histórico, data e linha do valor com C/D", () => {
    const read = readCaixa([
      "Extrato",
      "SALDO ANTERIOR",
      "01/09/2026",
      "000000 SALDO R$ 0,00 R$ 100,00 C",
      "PIX ENVIADO",
      "02/09/2026",
      "021234 MARIA SILVA R$ 50,00 R$ 50,00 C",
      "PIX RECEBIDO",
      "03/09/2026",
      "031234 JOAO SOUZA R$ 30,00 R$ 80,00 C",
      "COMPRA ELO",
      "04/09/2026",
      "041234 PADARIA SOL R$ 10,00 R$ 70,00 D",
    ])!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-09-02", "Pix enviado", "MARIA SILVA", 5000],
      ["2026-09-03", "Pix recebido", "JOAO SOUZA", 3000],
      ["2026-09-04", "Compra elo", "PADARIA SOL", -1000],
    ]);
  });
});

// Modelos montados a partir do layout de cada banco (sem leitor próprio, eles
// passam pela leitura geral; o Inter tem o seu).
describe("leitura geral: outros bancos", () => {
  const clean = (rows: { description: string }[]) => rows.map((row) => cleanStatementDescription(row.description));

  it("Itaú: data grudada no nome sai, saldo final é o último 'saldo do dia'", () => {
    const read = readLinesWithoutAi([
      "01/10/2026 SALDO ANTERIOR 1.000,00",
      "02/10/2026 PIX TRANSF JOAO S02/10 -150,00",
      "02/10/2026 SALDO DO DIA 850,00",
      "05/10/2026 TED 341.1234 MARIA SOUZA 2.000,00",
      "05/10/2026 SALDO DO DIA 2.850,00",
    ]);
    expect(read.rows.map((row) => row.amountCents)).toEqual([-15000, 200000]);
    expect(clean(read.rows)).toEqual(["PIX TRANSF JOAO S", "TED MARIA SOUZA"]);
    expect(reconcile(read).reconciled).toBe(true);
  });

  it("Mercado Pago: data com traço e saldo inicial/final na mesma linha", () => {
    const read = readLinesWithoutAi([
      "Saldo inicial: R$ 1.000,00 Saldo final: R$ 2.804,10",
      "02-10-2026 Transferência Pix enviada JOAO DA SILVA 12345678901 R$ -150,00 R$ 850,00",
      "02-10-2026 Pagamento com QR Pix IFOOD 12345678902 R$ -45,90 R$ 804,10",
      "05-10-2026 Transferência Pix recebida MARIA SOUZA 12345678903 R$ 2.000,00 R$ 2.804,10",
    ]);
    expect(read.rows.map((row) => [row.date, row.amountCents])).toEqual([
      ["2026-10-02", -15000],
      ["2026-10-02", -4590],
      ["2026-10-05", 200000],
    ]);
    expect(clean(read.rows)[0]).toBe("Transferência Pix enviada JOAO DA SILVA");
    expect(reconcile(read).reconciled).toBe(true);
  });

  it("PicPay: sinal separado do R$ ('- R$ 150,00') não se perde", () => {
    const read = readLinesWithoutAi([
      "02/10/2026 14:22 Pix enviado JOAO DA SILVA - R$ 150,00",
      "05/10/2026 09:10 Pix recebido MARIA SOUZA + R$ 2.000,00",
    ]);
    expect(read.rows.map((row) => row.amountCents)).toEqual([-15000, 200000]);
    expect(clean(read.rows)).toEqual(["Pix enviado JOAO DA SILVA", "Pix recebido MARIA SOUZA"]);
  });

  it("C6: a segunda data (contábil) não fica no nome", () => {
    const read = readLinesWithoutAi(["02/10 02/10 Pix enviado para JOAO DA SILVA -150,00", "Período 01/10/2026 a 31/10/2026"]);
    expect(read.rows[0].date).toBe("2026-10-02");
    expect(clean(read.rows)).toEqual(["Pix enviado para JOAO DA SILVA"]);
  });
});

describe("readInter", () => {
  it("dia por extenso, tipo separado do nome e saldo de cada linha conferido", () => {
    const read = readInter([
      "1 de Outubro de 2026 Saldo do dia: R$ 1.000,00",
      "2 de Outubro de 2026 Saldo do dia: R$ 804,10",
      'Pix enviado: "Cp :18236120-JOAO DA SILVA" -R$ 150,00 R$ 850,00',
      'Compra no debito: "No estabelecimento IFOOD" -R$ 45,90 R$ 804,10',
      "5 de Outubro de 2026 Saldo do dia: R$ 2.804,10",
      'Pix recebido: "Cp :00000000-MARIA SOUZA" R$ 2.000,00 R$ 2.804,10',
    ])!;
    expect(read.rows.map((row) => [row.date, row.kind, row.description, row.amountCents])).toEqual([
      ["2026-10-02", "Pix enviado", "JOAO DA SILVA", -15000],
      ["2026-10-02", "Compra no debito", "IFOOD", -4590],
      ["2026-10-05", "Pix recebido", "MARIA SOUZA", 200000],
    ]);
    expect(read.openingBalanceCents).toBe(100000);
    expect(read.closingBalanceCents).toBe(280410);
    expect(read.mismatched).toEqual([]);
  });

  it("aponta a linha cujo saldo não bate", () => {
    const read = readInter([
      "2 de Outubro de 2026 Saldo do dia: R$ 850,00",
      'Pix enviado: "Cp :1-JOAO" -R$ 150,00 R$ 850,00',
      'Pix enviado: "Cp :1-ANA" -R$ 50,00 R$ 790,00',
    ])!;
    expect(read.mismatched).toEqual(['Pix enviado: "Cp :1-ANA" -R$ 50,00 R$ 790,00']);
  });

  it("não é Inter sem o dia por extenso", () => {
    expect(readInter(["02/10/2026 PIX -150,00"])).toBeNull();
  });
});
