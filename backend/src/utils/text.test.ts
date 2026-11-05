import { describe, expect, it } from "vitest";
import { plainText } from "./text";

describe("plainText", () => {
  it("tira acento e maiúscula, e deixa o resto como está", () => {
    expect(plainText("Pão de Açúcar 0877")).toBe("pao de acucar 0877");
    expect(plainText("CRÉDITO  Pix")).toBe("credito  pix");
  });
});
