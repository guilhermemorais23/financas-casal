// Lançamento criado por outra tela (fatura paga, parcela de dívida, reembolso,
// lista de compras): o backend não deixa apagar nem mudar valor/data/conta
// por aqui -- só desfazendo lá. Antigos sem linkKind: o pagamento de fatura
// é o único com divisão "custom"; os demais o backend recusa com a mensagem
// de onde desfazer.
import { formatCurrency } from "./format";
import { isPendingTransaction } from "./optimisticTransactions";

export type LinkKind = "card_statement" | "debt_installment" | "settlement" | "shopping";

export function isLinkedTransaction(tx: { linkKind?: LinkKind | null; splitType?: string }): boolean {
  return Boolean(tx.linkKind) || tx.splitType === "custom";
}

// Linha que não se mexe pelo extrato (sem Editar/Excluir, fora do "excluir
// vários"): transferência de cartão garantido, empréstimo ou meta -- que só a
// tela delas desfaz -- ou lançamento ainda a caminho do servidor.
export function isReadOnlyRow(tx: {
  id: string;
  securedCardId?: string | null;
  loanId?: string | null;
  goalId?: string | null;
}): boolean {
  return Boolean(tx.securedCardId || tx.loanId || tx.goalId) || isPendingTransaction(tx);
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

// Dá pra excluir pelo extrato desfazendo na origem (o backend desmarca a
// parcela ou reabre a fatura). Reembolso e lista de compras: só lá.
export function canDeleteFromStatement(tx: { linkKind?: LinkKind | null; splitType?: string }): boolean {
  const kind = tx.linkKind ?? (tx.splitType === "custom" ? "card_statement" : null);
  return kind === null || kind === "debt_installment" || kind === "card_statement";
}

// O que acontece ao excluir pelo extrato (texto da confirmação).
export function deleteLinkedNote(tx: { linkKind?: LinkKind | null; splitType?: string }): string | null {
  const kind = tx.linkKind ?? (tx.splitType === "custom" ? "card_statement" : null);
  if (kind === "debt_installment") return "É uma parcela de dívida: ela volta a ficar em aberto em Dívidas.";
  if (kind === "card_statement") return "É o pagamento de uma fatura: a fatura volta a ficar aberta em Cartões.";
  return null;
}

// "Passar pra minha conta" (Par) / "Passar pro grupo" (Painel): lançamento
// comum, ou o guardado de um cartão garantido (o cartão muda junto). Fatura,
// parcela, reembolso, lista de compras, empréstimo, meta e transferência entre
// contas só mudam pela tela de origem.
export function canMoveAccount(tx: {
  id: string;
  securedCardId?: string | null;
  loanId?: string | null;
  goalId?: string | null;
  transferKind?: string | null;
  linkKind?: LinkKind | null;
  splitType?: string;
}): boolean {
  if (isPendingTransaction(tx) || tx.loanId || tx.goalId || tx.transferKind) return false;
  return Boolean(tx.securedCardId) || !isLinkedTransaction(tx);
}

// Confirmação do "Passar pra ..." -- diz o que muda pro grupo.
export function moveConfirm(
  tx: { amount: string; securedCardId?: string | null },
  to: "personal" | "joint"
): { title: string; body: string; confirmLabel: string } {
  const amount = formatCurrency(Number(tx.amount));
  if (to === "personal") {
    return {
      title: "Passar pra sua conta?",
      body: tx.securedCardId
        ? "O cartão passa a ser só seu: o dinheiro guardado nele sai da Nossa Conta e passa a sair da sua conta pessoal. Continua no seu Painel; o grupo deixa de ver."
        : `${amount} sai da Nossa Conta e vai pra sua conta pessoal. Continua no seu Painel; o grupo deixa de ver.`,
      confirmLabel: "Passar pra minha conta",
    };
  }
  return {
    title: "Passar pro grupo?",
    body: tx.securedCardId
      ? "O cartão passa a ser do grupo: o dinheiro guardado nele sai da sua conta pessoal e passa a sair da Nossa Conta. Todo mundo do grupo passa a ver."
      : `${amount} sai da sua conta pessoal e vai pra Nossa Conta. Todo mundo do grupo passa a ver, no Par e no Painel.`,
    confirmLabel: "Passar pro grupo",
  };
}

// Texto da confirmação de "Excluir" -- o mesmo no Painel, no Par e nos
// Relatórios. `where` muda só o começo (o Par fala da conta conjunta).
// Lançamento da Nossa Conta aparece no Par e no Painel de todo mundo: é o
// mesmo lançamento, então avisa que some de todos os lugares.
export function deleteConfirmBody(
  tx: { amount: string; linkKind?: LinkKind | null; splitType?: string; accountType?: "personal" | "joint" },
  where = "do extrato e dos totais do mês"
): string {
  return [
    `${formatCurrency(Number(tx.amount))} sai ${where}.`,
    tx.accountType === "joint" ? "É da Nossa Conta: some do Par e do Painel de todo mundo do grupo." : null,
    deleteLinkedNote(tx),
    "Você ainda vai poder desfazer por alguns segundos.",
  ]
    .filter(Boolean)
    .join(" ");
}
