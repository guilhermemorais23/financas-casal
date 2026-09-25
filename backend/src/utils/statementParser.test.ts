import { describe, expect, it } from "vitest";
import {
  StatementParseError,
  cleanStatementDescription,
  parseAmountToCents,
  parseDate,
  parseStatement,
  splitCsvLine,
} from "./statementParser";

describe("parseAmountToCents", () => {
  it("reads Brazilian and plain formats", () => {
    expect(parseAmountToCents("1.234,56")).toBe(123456);
    expect(parseAmountToCents("-1234.56")).toBe(-123456);
    expect(parseAmountToCents("R$ 12,50")).toBe(1250);
    expect(parseAmountToCents("(12,50)")).toBe(-1250);
    expect(parseAmountToCents("12,50-")).toBe(-1250);
    expect(parseAmountToCents("1,234.56")).toBe(123456);
  });

  it("returns null for non-numbers", () => {
    expect(parseAmountToCents("")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
  });
});

describe("parseDate", () => {
  it("normalizes the common bank formats", () => {
    expect(parseDate("21/09/2026")).toBe("2026-09-21");
    expect(parseDate("21/09/26")).toBe("2026-09-21");
    expect(parseDate("2026-09-21")).toBe("2026-09-21");
    expect(parseDate("20260921120000[-3:BRT]")).toBe("2026-09-21");
    expect(parseDate("99/99/2026")).toBeNull();
  });
});

describe("parseStatement: OFX", () => {
  const ofx = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260920120000[-3:BRT]
<TRNAMT>-18.90
<FITID>abc1
<MEMO>Padaria Central
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260916
<TRNAMT>150.00
<FITID>abc2
<NAME>Pix recebido
<MEMO>Pix recebido Ana &amp; Cia
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

  it("reads SGML-style OFX with unclosed tags", () => {
    const { format, rows } = parseStatement(ofx);
    expect(format).toBe("ofx");
    expect(rows).toEqual([
      { date: "2026-09-20", description: "Padaria Central", amountCents: -1890, externalId: "abc1" },
      { date: "2026-09-16", description: "Pix recebido Ana & Cia", amountCents: 15000, externalId: "abc2" },
    ]);
  });
});

describe("parseStatement: CSV", () => {
  it("reads a semicolon CSV with Brazilian numbers and a preamble", () => {
    const csv = [
      "Extrato conta corrente",
      "Agencia: 0001",
      "Data;Histórico;Valor",
      '21/09/2026;"Mercado; Extra";-187,40',
      "20/09/2026;Salário;4.200,00",
      "linha;quebrada;x",
    ].join("\n");
    const { format, rows } = parseStatement(csv);
    expect(format).toBe("csv");
    expect(rows).toEqual([
      { date: "2026-09-21", description: "Mercado; Extra", amountCents: -18740, externalId: null },
      { date: "2026-09-20", description: "Salário", amountCents: 420000, externalId: null },
    ]);
  });

  it("reads separate debit and credit columns", () => {
    const csv = ["Data,Descrição,Débito,Crédito", "05/09/2026,Aluguel,1450.00,", "12/09/2026,Freelance,,650.00"].join("\n");
    const { rows } = parseStatement(csv);
    expect(rows.map((r) => r.amountCents)).toEqual([-145000, 65000]);
  });

  it("reads the date,title,amount layout (positive = purchase is left to the caller)", () => {
    const csv = ["date,category,title,amount", "2026-09-15,streaming,Netflix,55.90"].join("\n");
    const { rows } = parseStatement(csv);
    expect(rows).toEqual([{ date: "2026-09-15", description: "Netflix", amountCents: 5590, externalId: null }]);
  });

  it("não usa 'Data Lançamento' como descrição e prefere o nome ao histórico", () => {
    const csv = [
      "Data Lançamento;Histórico;Descrição;Valor;Saldo",
      "02/09/2026;Pix enviado;MARIA SILVA;-50,00;950,00",
      "03/09/2026;Pix enviado;JOAO PEREIRA;-30,00;920,00",
      "04/09/2026;Tarifa;;-5,00;915,00",
    ].join("\n");
    const { rows } = parseStatement(csv);
    expect(rows.map((r) => r.description)).toEqual(["MARIA SILVA", "JOAO PEREIRA", "Tarifa"]);
  });

  it("pula a coluna de número do documento", () => {
    const csv = ["Data;Documento;Descrição;Valor", "02/09/2026;000123;;-50,00"].join("\n");
    expect(parseStatement(csv).rows[0].description).toBe("Lançamento importado");
    const named = ["Data;Descrição;Favorecido;Valor", "02/09/2026;123456;PADARIA SOL;-8,00"].join("\n");
    expect(parseStatement(named).rows[0].description).toBe("PADARIA SOL");
  });

  it("explains itself when the columns are not recognized", () => {
    expect(() => parseStatement("a,b,c\n1,2,3")).toThrow(StatementParseError);
  });

  it("splits quoted fields with doubled quotes", () => {
    expect(splitCsvLine('a,"b ""x"", c",d', ",")).toEqual(["a", 'b "x", c', "d"]);
  });
});

describe("cleanStatementDescription", () => {
  it("tira documento, CPF, agência/conta, data e hora do nome", () => {
    expect(cleanStatementDescription("PIX ENVIADO 1234567 DES: MARIA SILVA 02/09")).toBe("PIX ENVIADO DES: MARIA SILVA");
    expect(
      cleanStatementDescription("Transferência enviada pelo Pix - MARIA SILVA - •••.123.456-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 1234-5")
    ).toBe("Transferência enviada pelo Pix - MARIA SILVA - NU PAGAMENTOS - IP");
    expect(cleanStatementDescription("PAO DE ACUCAR 1204")).toBe("PAO DE ACUCAR");
    expect(cleanStatementDescription("UBER *TRIP")).toBe("UBER *TRIP");
    expect(cleanStatementDescription("99 FOOD")).toBe("99 FOOD");
    expect(cleanStatementDescription("000123")).toBe("000123");
  });
});
