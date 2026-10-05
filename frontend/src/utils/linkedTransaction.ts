// Lançamento criado por outra tela (fatura paga, parcela de dívida, reembolso,
// lista de compras): o backend não deixa apagar nem mudar valor/data/conta
// por aqui -- só desfazendo lá. Antigos sem linkKind: o pagamento de fatura
// é o único com divisão "custom"; os demais o backend recusa com a mensagem
// de onde desfazer.
export type LinkKind = "card_statement" | "debt_installment" | "settlement" | "shopping";

export function isLinkedTransaction(tx: { linkKind?: LinkKind | null; splitType?: string }): boolean {
  return Boolean(tx.linkKind) || tx.splitType === "custom";
}

export function linkedHint(tx: { linkKind?: LinkKind | null; splitType?: string }): string {
  const kind = tx.linkKind ?? (tx.splitType === "custom" ? "card_statement" : null);
  switch (kind) {
    case "card_statement":
      return "Pagamento de fatura: valor e data mudam desmarcando a fatura na página Cartões.";
    case "debt_installment":
      return "Parcela de dívida: valor e data mudam pela página Dívidas.";
    case "settlement":
      return "Reembolso de despesa dividida: desfaça marcando a despesa como em aberto.";
    case "shopping":
      return "Veio da lista de compras: desfaça desmarcando o item na lista.";
    default:
      return "";
  }
}
