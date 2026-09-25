import { listCards, savedInSecuredCardsCents } from "../cards/cards.service";
import { listDebts } from "../debts/debts.service";
import { getGroupForUser } from "../groups/groups.service";
import { listRecurringBillsForUser } from "../recurringBills/recurringBills.service";
import { paymentsUntil, type PaymentAhead } from "../upcoming/upcoming.service";
import { listLoans, todayInBrazil, type LoanWithTotals, type LoansSummary } from "./loans.service";

export interface LoansOverview {
  loans: LoanWithTotals[];
  summary: LoansSummary;
  // "Seu dinheiro hoje", somado igual ao Painel: contas que a pessoa vê +
  // o que está guardado em cartões com limite garantido.
  moneyToday: number;
  // O que vence até o último prazo em aberto -- a tela tira isso de cada
  // "quando pagar, você fica com".
  paymentsAhead: PaymentAhead[];
}

export async function getLoansOverview(userId: string): Promise<LoansOverview> {
  const [list, group, cards, debts, bills] = await Promise.all([
    listLoans(userId),
    getGroupForUser(userId),
    listCards(userId),
    listDebts(userId),
    listRecurringBillsForUser(userId),
  ]);
  const today = todayInBrazil();
  const accountsCents = (group?.accounts ?? []).reduce((sum, account) => sum + Math.round(account.balance * 100), 0);
  const lastDue = list.loans
    .filter((loan) => loan.status === "open" && loan.dueDate)
    .reduce((max, loan) => (loan.dueDate! > max ? loan.dueDate! : max), today);
  return {
    ...list,
    moneyToday: (accountsCents + savedInSecuredCardsCents(cards)) / 100,
    paymentsAhead: paymentsUntil({ cards, debts, bills, today, until: lastDue }),
  };
}
