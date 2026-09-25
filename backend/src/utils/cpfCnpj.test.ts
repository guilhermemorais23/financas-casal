import { describe, expect, it } from "vitest";
import { isValidCpfCnpj } from "./cpfCnpj";

describe("isValidCpfCnpj", () => {
  it("aceita CPF e CNPJ válidos, com ou sem pontuação", () => {
    expect(isValidCpfCnpj("529.982.247-25")).toBe(true);
    expect(isValidCpfCnpj("52998224725")).toBe(true);
    expect(isValidCpfCnpj("11.222.333/0001-81")).toBe(true);
  });

  it("recusa dígito errado, repetido ou tamanho errado", () => {
    expect(isValidCpfCnpj("529.982.247-24")).toBe(false);
    expect(isValidCpfCnpj("111.111.111-11")).toBe(false);
    expect(isValidCpfCnpj("1234")).toBe(false);
    expect(isValidCpfCnpj("11.222.333/0001-80")).toBe(false);
  });
});
