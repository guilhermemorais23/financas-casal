import { describe, expect, it } from "vitest";
import { parseMoney, toMoneyInput } from "./money";

describe("parseMoney", () => {
  it("lê vírgula como decimal", () => {
    expect(parseMoney("54,90")).toBe(54.9);
    expect(parseMoney("0,05")).toBe(0.05);
  });

  it("lê ponto de milhar com vírgula decimal", () => {
    expect(parseMoney("1.234,56")).toBe(1234.56);
    expect(parseMoney("12.345.678,90")).toBe(12345678.9);
  });

  it("lê ponto de milhar sem decimal", () => {
    expect(parseMoney("1.500")).toBe(1500);
    expect(parseMoney("2.000.000")).toBe(2000000);
  });

  it("lê ponto como decimal quando tem 1 ou 2 casas (teclado do iPhone em inglês)", () => {
    expect(parseMoney("54.90")).toBe(54.9);
    expect(parseMoney("5000.5")).toBe(5000.5);
  });

  it("ignora espaços e R$", () => {
    expect(parseMoney(" R$ 1.234,56 ")).toBe(1234.56);
  });

  it("aceita inteiro simples", () => {
    expect(parseMoney("150")).toBe(150);
  });

  it("devolve NaN pra texto que não é valor", () => {
    expect(parseMoney("abc")).toBeNaN();
    expect(parseMoney("1,2,3")).toBeNaN();
  });

  it("campo vazio vira 0", () => {
    expect(parseMoney("")).toBe(0);
  });
});

describe("toMoneyInput", () => {
  it("mostra o número com vírgula e 2 casas", () => {
    expect(toMoneyInput(1234.5)).toBe("1234,50");
    expect(toMoneyInput(0)).toBe("0,00");
  });

  it("devolve o que parseMoney lê de volta", () => {
    expect(parseMoney(toMoneyInput(1234.5))).toBe(1234.5);
  });
});
