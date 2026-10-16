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

// "R$ 1.234,56" -- pra mensagens (e-mail, Telegram, alertas).
export function formatBRL(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
