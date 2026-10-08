import { describe, expect, it } from "vitest";
import { detectPaymentMethod, paymentFromSpeech } from "./paymentDetect";

describe("forma de pagamento pelo texto do banco", () => {
  it("reconhece Pix, débito e compra no crédito", () => {
    expect(detectPaymentMethod(["PIX ENVIADO MARIA"], "expense")).toBe("pix");
    expect(detectPaymentMethod(["Maria", "Pix recebido"], "income")).toBe("pix");
    expect(detectPaymentMethod(["COMPRA CARTAO DEB PADARIA"], "expense")).toBe("debit");
    expect(detectPaymentMethod(["Padaria", "Compra no débito"], "expense")).toBe("debit");
    expect(detectPaymentMethod(["COMPRA CREDITO A VISTA LOJA"], "expense")).toBe("credit");
  });

  it("na dúvida não chuta", () => {
    expect(detectPaymentMethod(["MERCADO EXTRA"], "expense")).toBeNull();
    // Crédito numa entrada é dinheiro entrando, não cartão.
    expect(detectPaymentMethod(["CREDITO EM CONTA"], "income")).toBeNull();
    expect(detectPaymentMethod(["DEBITO AUTOMATICO LUZ"], "expense")).toBeNull();
  });
});

describe("forma de pagamento na mensagem", () => {
  it("tira a forma da descrição", () => {
    expect(paymentFromSpeech("no pix no mercado")).toEqual({ method: "pix", rest: "no mercado" });
    expect(paymentFromSpeech("uber no crédito")).toEqual({ method: "credit", rest: "uber" });
    expect(paymentFromSpeech("padaria no débito")).toEqual({ method: "debit", rest: "padaria" });
    expect(paymentFromSpeech("feira em dinheiro")).toEqual({ method: "cash", rest: "feira" });
    expect(paymentFromSpeech("mercado")).toEqual({ method: null, rest: "mercado" });
  });
});
