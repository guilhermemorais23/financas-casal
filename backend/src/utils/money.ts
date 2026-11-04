// Todo dinheiro fica no Firestore como centavos inteiros (evita erro de
// arredondamento -- número no Firestore é double do JS). O contrato da API
// com o frontend continua em texto decimal, como "200.00"; a conversão
// acontece só na borda do repository.
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// Divide totalAmount em `count` partes o mais iguais possível, em centavos,
// dando o centavo que sobra pras primeiras partes (assim nada se perde nem
// aparece no arredondamento). Usado nas parcelas de dívida e nas partes de
// gasto dividido igual entre os membros do grupo.
export function splitEvenly(totalAmount: number, count: number): number[] {
  const totalCents = toCents(totalAmount);
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

// Valor digitado por uma pessoa ("54,90", "1.234,56", "1.500", "54.90") ->
// número. As mesmas regras do parseMoney do frontend (utils/money.ts lá):
// com vírgula, ela é o decimal e os pontos são milhar; sem vírgula, ponto
// seguido de grupos de 3 dígitos é milhar e os outros pontos são decimal.
export function parseTypedAmount(raw: string): number {
  const clean = raw.trim();
  if (clean.includes(",")) return Number(clean.replace(/\./g, "").replace(",", "."));
  if (/^\d{1,3}(\.\d{3})+$/.test(clean)) return Number(clean.replace(/\./g, ""));
  return Number(clean);
}

// "R$ 1.234,56" -- pra mensagens (e-mail, Telegram, alertas).
export function formatBRL(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
