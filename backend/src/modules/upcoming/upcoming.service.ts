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
    const owe = loan.direction === "borrowed";
    items.push({
      id: `loan-${loan.id}`,
      kind: "loan",
      direction: owe ? "pay" : "receive",
      title: loan.personName,
      detail: owe ? "Você devolve" : "Te devolve",
      amount: Number(loan.remaining),
      dueDate: loan.dueDate,
      daysUntil: daysBetween(today, loan.dueDate),
      link: "/loans",
    });
  }

  return items.sort((a, b) => (a.dueDate === b.dueDate ? a.title.localeCompare(b.title) : a.dueDate < b.dueDate ? -1 : 1));
}

export interface PaymentAhead {
  dueDate: string;
  amount: number;
}

// Tudo que ainda vai sair das contas até `until` (atrasados inclusive):
// faturas e parcelas de cartão, parcelas de dívidas e cada vez que uma conta
// fixa vai cair. A tela A receber usa pra dizer quanto você fica quando
// alguém te pagar, já tirando o que vence antes.
export function paymentsUntil(input: {
  cards: Awaited<ReturnType<typeof listCards>>;
  debts: Awaited<ReturnType<typeof listDebts>>;
  bills: Awaited<ReturnType<typeof listRecurringBillsForUser>>;
  today: string;
  until: string;
}): PaymentAhead[] {
  const { cards, debts, bills, today, until } = input;
  const items: PaymentAhead[] = [];

  for (const card of cards) {
    if (card.limitReleases.length > 0) {
      for (const release of card.limitReleases) {
        if (release.dueDate <= until) items.push({ dueDate: release.dueDate, amount: Number(release.amount) });
      }
      continue;
    }
    const statement = card.currentStatement;
    if (!statement.isPaid && Number(statement.total) > 0 && statement.dueDate <= until) {
      items.push({ dueDate: statement.dueDate, amount: Number(statement.total) });
    }
  }

  for (const debt of debts) {
    for (const installment of debt.installments) {
      if (installment.isPaid || !installment.dueDate || installment.dueDate > until) continue;
      items.push({ dueDate: installment.dueDate, amount: Number(installment.amount) });
    }
  }

  const thisMonth = today.slice(0, 7);
  for (const bill of bills) {
    if (!bill.isActive || bill.transactionType !== "expense") continue;
    let month = bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
    for (;;) {
      const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
      if (dueDate > until) break;
      // Dia que já passou: a conta fixa já lançou sozinha e está no saldo.
      if (dueDate >= today) items.push({ dueDate, amount: Number(bill.amount) });
      month = addMonths(month, 1);
    }
  }

  return items.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Tela Contas: tudo que você tem que pagar numa lista só, pela data --
// faturas, parcelas e contas fixas dos próximos BILLS_WINDOW_DAYS (atrasados
// inclusive), o que já foi pago neste mês e, à parte, os empréstimos.
// ---------------------------------------------------------------------------
export const BILLS_WINDOW_DAYS = 30;

export type BillPayAction =
  | { type: "card"; cardId: string; month: string }
  | { type: "debt"; debtId: string; installmentId: string };

export interface BillItem {
  id: string;
  kind: "card" | "debt" | "recurring";
  title: string;
  amount: number;
  // null = parcelada sem dia de vencimento.
  dueDate: string | null;
  daysUntil: number | null;
  isPaid: boolean;
  // Conta fixa lança sozinha no dia: não tem botão de pagar.
  pay: BillPayAction | null;
  link: string;
  card?: { closingDay: number; limitFree: number | null };
  debt?: { installmentNumber: number; installmentsCount: number; paidCount: number; remainingAmount: number };
}

export interface BillLoan {
  id: string;
  direction: "lent" | "borrowed";
  personName: string;
  remaining: number;
  dueDate: string | null;
  isOverdue: boolean;
}

export interface BillsOverview {
  today: string;
  items: BillItem[];
  loans: BillLoan[];
  summary: { toPay: number; overdueCount: number; dueSoonCount: number };
}

export async function getBillsOverview(userId: string): Promise<BillsOverview> {
  const today = todayInBrazil();
  const thisMonth = today.slice(0, 7);
  const [cards, debts, bills, loans] = await Promise.all([
    listCards(userId),
    listDebts(userId),
    listRecurringBillsForUser(userId),
    listLoans(userId),
  ]);
  const items: BillItem[] = [];
  const inWindow = (dueDate: string) => daysBetween(today, dueDate) <= BILLS_WINDOW_DAYS;
  const paidThisMonth = (dueDate: string | null) => !!dueDate && dueDate.slice(0, 7) === thisMonth;

  for (const card of cards) {
    const limitFree = card.limit !== null && card.limitUsed !== null ? Number(card.limit) - Number(card.limitUsed) : null;
    const push = (month: string, dueDate: string, amount: number, isPaid: boolean) =>
      items.push({
        id: `card-${card.id}-${month}`,
        kind: "card",
        title: `Fatura ${card.name}`,
        amount,
        dueDate,
        daysUntil: daysBetween(today, dueDate),
        isPaid,
        pay: { type: "card", cardId: card.id, month },
        link: "/cards",
        card: { closingDay: card.closingDay, limitFree },
      });
    const statement = card.currentStatement;
    // Faturas anteriores ainda em aberto (só dá pra saber em cartão com
    // limite, que guarda a linha do tempo de cada fatura não paga).
    for (const release of card.limitReleases) {
      if (release.month !== statement.month && inWindow(release.dueDate)) push(release.month, release.dueDate, Number(release.amount), false);
    }
    if (Number(statement.total) <= 0) continue;
    if (statement.isPaid ? paidThisMonth(statement.dueDate) : inWindow(statement.dueDate)) {
      push(statement.month, statement.dueDate, Number(statement.total), statement.isPaid);
    }
  }

  for (const debt of debts) {
    const sorted = [...debt.installments].sort((a, b) => a.installmentNumber - b.installmentNumber);
    const nextUnpaid = sorted.find((installment) => !installment.isPaid);
    for (const installment of sorted) {
      const shown = installment.isPaid
        ? paidThisMonth(installment.dueDate)
        : installment.dueDate
        ? inWindow(installment.dueDate)
        : installment === nextUnpaid;
      if (!shown) continue;
      items.push({
        id: `debt-${debt.id}-${installment.id}`,
        kind: "debt",
        title: debt.name,
        amount: Number(installment.amount),
        dueDate: installment.dueDate,
        daysUntil: installment.dueDate ? daysBetween(today, installment.dueDate) : null,
        isPaid: installment.isPaid,
        pay: { type: "debt", debtId: debt.id, installmentId: installment.id },
        link: "/a-pagar?aba=dividas",
        debt: {
          installmentNumber: installment.installmentNumber,
          installmentsCount: debt.installmentsCount,
          paidCount: debt.paidCount,
          remainingAmount: debt.remainingAmount,
        },
      });
    }
  }

  for (const bill of bills) {
    if (!bill.isActive || bill.transactionType !== "expense") continue;
    const base = { kind: "recurring" as const, title: bill.description, amount: Number(bill.amount), pay: null, link: "/a-pagar?aba=fixas" };
    if (bill.lastGeneratedMonth === thisMonth) {
      const dueDate = dateForDayInMonth(thisMonth, bill.dayOfMonth);
      items.push({ ...base, id: `recurring-${bill.id}-${thisMonth}`, dueDate, daysUntil: daysBetween(today, dueDate), isPaid: true });
    }
    const month = bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
    const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
    const daysUntil = daysBetween(today, dueDate);
    if (daysUntil < 0 || daysUntil > BILLS_WINDOW_DAYS) continue;
    items.push({ ...base, id: `recurring-${bill.id}-${month}`, dueDate, daysUntil, isPaid: false });
  }

  const byDate = (a: BillItem, b: BillItem) =>
    (a.dueDate ?? "9999") === (b.dueDate ?? "9999") ? a.title.localeCompare(b.title) : (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
  items.sort(byDate);

  const open = items.filter((item) => !item.isPaid);
  return {
    today,
    items,
    loans: loans.loans
      .filter((loan) => loan.status === "open" && Number(loan.remaining) > 0)
      .map((loan) => ({
        id: loan.id,
        direction: loan.direction,
        personName: loan.personName,
        remaining: Number(loan.remaining),
        dueDate: loan.dueDate,
        isOverdue: loan.isOverdue,
      })),
    summary: {
      toPay: Math.round(open.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
      overdueCount: open.filter((item) => item.daysUntil !== null && item.daysUntil < 0).length,
      dueSoonCount: open.filter((item) => item.daysUntil !== null && item.daysUntil >= 0 && item.daysUntil <= UPCOMING_WINDOW_DAYS).length,
    },
  };
}
