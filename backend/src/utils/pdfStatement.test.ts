import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PdfPasswordError, parsePdfStatement, readLinesWithoutAi, reconcile } from "./pdfStatement";

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
