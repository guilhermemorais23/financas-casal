import { listCards } from "../cards/cards.service";
import { listDebts } from "../debts/debts.service";
import { listLoans, todayInBrazil } from "../loans/loans.service";
import { listRecurringBillsForUser } from "../recurringBills/recurringBills.service";
import { addMonths, dateForDayInMonth, daysBetween } from "../../utils/month";

// "Vence logo": tudo que tem data na próxima semana -- o que você tem que
// pagar (faturas, parcelas, contas fixas) e o que vai voltar pra você
// (empréstimos com prazo). Atrasados continuam na lista até serem resolvidos.
// O Painel mostra, o assistente lê.
export const UPCOMING_WINDOW_DAYS = 7;

export type UpcomingKind = "card" | "debt" | "recurring" | "loan";

export interface UpcomingItem {
  id: string;
  kind: UpcomingKind;
  direction: "pay" | "receive";
  title: string;
  detail: string;
  amount: number;
  dueDate: string;
  daysUntil: number;
  link: string;
}

export async function getUpcomingForUser(userId: string, windowDays = UPCOMING_WINDOW_DAYS): Promise<UpcomingItem[]> {
  const today = todayInBrazil();
  const thisMonth = today.slice(0, 7);
  const [cards, debts, bills, loans] = await Promise.all([
    listCards(userId),
    listDebts(userId),
    listRecurringBillsForUser(userId),
    listLoans(userId),
  ]);

  const items: UpcomingItem[] = [];
  const within = (dueDate: string) => daysBetween(today, dueDate) <= windowDays;

  for (const card of cards) {
    const statement = card.currentStatement;
    if (statement.isPaid || Number(statement.total) <= 0 || !within(statement.dueDate)) continue;
    items.push({
      id: `card-${card.id}`,
      kind: "card",
      direction: "pay",
      title: `Fatura ${card.name}`,
      detail: "Cartão",
      amount: Number(statement.total),
      dueDate: statement.dueDate,
      daysUntil: daysBetween(today, statement.dueDate),
      link: "/cards",
    });
  }

  for (const debt of debts) {
    const next = debt.installments
      .filter((installment) => !installment.isPaid)
      .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    if (!next?.dueDate || !within(next.dueDate)) continue;
    items.push({
      id: `debt-${debt.id}`,
      kind: "debt",
      direction: "pay",
      title: debt.name,
      detail: `Parcela ${next.installmentNumber}/${debt.installmentsCount}`,
      amount: Number(next.amount),
      dueDate: next.dueDate,
      daysUntil: daysBetween(today, next.dueDate),
      link: "/debts",
    });
  }

  for (const bill of bills) {
    if (!bill.isActive || bill.transactionType !== "expense") continue;
    const month = bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
    const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
    const daysUntil = daysBetween(today, dueDate);
    // A conta fixa lança sozinha no dia -- depois que o dia passa ela está
    // paga, nunca "atrasada".
    if (daysUntil < 0 || daysUntil > windowDays) continue;
    items.push({
      id: `recurring-${bill.id}-${month}`,
      kind: "recurring",
      direction: "pay",
      title: bill.description,
      detail: "Conta fixa",
      amount: Number(bill.amount),
      dueDate,
      daysUntil,
      link: "/recurring-bills",
    });
  }

  for (const loan of loans.loans) {
    if (loan.status !== "open" || !loan.dueDate || Number(loan.remaining) <= 0 || !within(loan.dueDate)) continue;
    items.push({
      id: `loan-${loan.id}`,
      kind: "loan",
      direction: "receive",
      title: loan.personName,
      detail: "Te devolve",
      amount: Number(loan.remaining),
      dueDate: loan.dueDate,
      daysUntil: daysBetween(today, loan.dueDate),
      link: "/loans",
    });
  }

  return items.sort((a, b) => (a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1));
}
