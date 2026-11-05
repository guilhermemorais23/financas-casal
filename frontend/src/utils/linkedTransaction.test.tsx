// Excluir pelo extrato: a mesma regra e o mesmo aviso no Painel, no Par e nos
// Relatórios (antes cada tela tinha a sua, e o Painel escondia o Excluir de
// fatura paga e parcela de dívida que os Relatórios deixavam excluir).
import { describe, expect, it } from "vitest";
import { canDeleteFromStatement, deleteConfirmBody } from "./linkedTransaction";

describe("excluir pelo extrato", () => {
  it("parcela de dívida e fatura paga dá pra excluir; reembolso e lista de compras não", () => {
    expect(canDeleteFromStatement({ linkKind: null })).toBe(true);
    expect(canDeleteFromStatement({ linkKind: "debt_installment" })).toBe(true);
    expect(canDeleteFromStatement({ linkKind: "card_statement" })).toBe(true);
    expect(canDeleteFromStatement({ linkKind: "settlement" })).toBe(false);
    expect(canDeleteFromStatement({ linkKind: "shopping" })).toBe(false);
  });

  it("o aviso diz o valor, o que volta a ficar em aberto e que dá pra desfazer", () => {
    expect(deleteConfirmBody({ amount: "57.79", linkKind: "debt_installment" }).replace(/\s/g, " ")).toBe(
      "R$ 57,79 sai do extrato e dos totais do mês. É uma parcela de dívida: ela volta a ficar em aberto em Dívidas. Você ainda vai poder desfazer por alguns segundos."
    );
    expect(deleteConfirmBody({ amount: "10.00", linkKind: null }).replace(/\s/g, " ")).toBe(
      "R$ 10,00 sai do extrato e dos totais do mês. Você ainda vai poder desfazer por alguns segundos."
    );
  });
});
