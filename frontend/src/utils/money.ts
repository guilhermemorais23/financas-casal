// Valor digitado num campo de dinheiro -> número. Os campos são texto com
// teclado decimal, então chega de tudo: "54,90", "1.234,56", "1.500" (mil e
// quinhentos) e "54.90" (teclado do iPhone com região em inglês).
//   - com vírgula: a vírgula é o decimal e os pontos são milhar;
//   - sem vírgula: ponto seguido de grupos de 3 dígitos é milhar ("1.500",
//     "2.000.000"); qualquer outro ponto é decimal ("54.90", "5000.5").
// Texto que não é valor dá NaN; campo vazio dá 0 (quem chama confere > 0).
export function parseMoney(value: string): number {
  const clean = value.trim().replace(/\s|R\$/g, "");
  if (clean.includes(",")) {
    return /^\d{1,3}(\.\d{3})*,\d*$|^\d+,\d*$/.test(clean) ? Number(clean.replace(/\./g, "").replace(",", ".")) : NaN;
  }
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) return Number(clean.replace(/\./g, ""));
  return Number(clean);
}

// Número -> texto do campo ("1234,50"), o formato que parseMoney lê de volta.
export function toMoneyInput(value: number): string {
  return value.toFixed(2).replace(".", ",");
}
