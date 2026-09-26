import { findCardsByGroupId, findStatement } from "../cards/cards.repository";
import { currentStatementMonth, dueDateFor } from "../cards/cards.service";
import { findGroupBudget, getMonthlyExpenseTotal } from "../budgets/budgets.repository";
import { findDebtsByGroupId, findInstallmentsByDebtIds } from "../debts/debts.repository";
import { escapeHtml, sendReminderEmail } from "../../email/mailer";
import { findLoansByGroup, todayInBrazil } from "../loans/loans.service";
import { findRecurringBillsByGroupId } from "../recurringBills/recurringBills.repository";
import { addMonths, daysBetween, dateForDayInMonth, parseMonthRange } from "../../utils/month";
import { generateDueRecurringBills } from "../recurringBills/recurringBills.service";
import { logError } from "../../utils/errorLog";
import { htmlToText, sendPushToUser } from "../push/push.service";
import { invalidateAllReads } from "../../utils/readCache";
import { getMonthCloseForUser, previousMonthInBrazil } from "../monthClose/monthClose.service";
import {
  claimDailyRun,
  findAllGroupIds,
  findMembersWithEmailByGroupId,
  markReminderSent,
  wasReminderSent,
  type MemberWithEmail,
} from "./reminders.repository";

// A card's due-date reminder fires the first time the cron notices its
// current statement is unpaid and within this many days of (or already
// past) the due date -- one email per statement, not one per day in range.
const CARD_REMINDER_WINDOW_DAYS = 7;

function formatBRDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatBRL(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Conta só os avisos que saíram de verdade (email ou notificação no
// celular) -- um lembrete só é marcado como enviado (e nunca reenviado)
// quando alguém realmente recebeu.
async function sendToMembers(members: MemberWithEmail[], subject: string, bodyHtml: string, url = "/contas"): Promise<number> {
  const withEmail = members.filter((member) => member.email);
  const text = htmlToText(bodyHtml.replace(/<h1[^>]*>.*?<\/h1>/i, ""));
  const [emails, pushes] = await Promise.all([
    Promise.all(withEmail.map((member) => sendReminderEmail(member.email!, subject, bodyHtml))),
    Promise.all(members.map((member) => sendPushToUser(member.id, { title: subject, body: text, url }))),
  ]);
  return emails.filter((result) => result.ok).length + pushes.filter((count) => count > 0).length;
}

function dueLabelFor(daysUntilDue: number): string {
  return daysUntilDue === 0
    ? "vence hoje"
    : daysUntilDue > 0
      ? `vence em ${daysUntilDue} dia${daysUntilDue === 1 ? "" : "s"}`
      : `venceu há ${-daysUntilDue} dia${-daysUntilDue === 1 ? "" : "s"}`;
}

async function runCardReminders(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = todayInBrazil();
  const cards = await findCardsByGroupId(groupId);
  let emailsSent = 0;

  for (const card of cards) {
    const statementMonth = currentStatementMonth(card.closingDay);
    const statement = await findStatement(card.id, statementMonth);
    if (statement?.isPaid) continue;

    const dueDate = dueDateFor(statementMonth, card.closingDay, card.dueDay);
    const daysUntilDue = daysBetween(today, dueDate);
    if (daysUntilDue > CARD_REMINDER_WINDOW_DAYS) continue;

    const key = `card:${card.id}:${statementMonth}`;
    if (await wasReminderSent(key)) continue;

    // ownerUserId null -> a joint card, everyone in the group used it and
    // should hear about it; otherwise just its owner.
    const recipients = card.ownerUserId
      ? membersById.has(card.ownerUserId)
        ? [membersById.get(card.ownerUserId)!]
        : []
      : members;

    const dueLabel = dueLabelFor(daysUntilDue);

    const sent = await sendToMembers(
      recipients,
      `Fatura do cartão "${card.name}" ${dueLabel}`,
      `
        <h1 style="font-size: 20px;">Fatura chegando</h1>
        <p>A fatura do cartão <strong>${card.name}</strong> ${dueLabel} (${formatBRDate(dueDate)}) e ainda não foi paga.</p>
        <p>Dá uma olhada no PAR. pra conferir o valor e marcar como paga.</p>
      `
    );
    if (sent > 0) {
      emailsSent += sent;
      await markReminderSent(key, { groupId, kind: "card", cardId: card.id, statementMonth, dueDate });
    }
  }

  return emailsSent;
}

// Same reasoning as CARD_REMINDER_WINDOW_DAYS -- one email per installment,
// the first time it's noticed to be due soon (or already overdue).
const DEBT_REMINDER_WINDOW_DAYS = 7;

async function runDebtReminders(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = todayInBrazil();
  const debts = await findDebtsByGroupId(groupId);
  const debtsWithDueDay = debts.filter((debt) => debt.dueDay !== null);
  if (debtsWithDueDay.length === 0) return 0;

  const installments = await findInstallmentsByDebtIds(debtsWithDueDay.map((debt) => debt.id));
  const installmentsByDebtId = new Map<string, typeof installments>();
  for (const installment of installments) {
    const list = installmentsByDebtId.get(installment.debtId);
    if (list) list.push(installment);
    else installmentsByDebtId.set(installment.debtId, [installment]);
  }

  let emailsSent = 0;
  for (const debt of debtsWithDueDay) {
    // Only the next unpaid parcela can be "coming due" -- once it's paid,
    // whichever one is next takes its place next time this runs.
    const nextUnpaid = (installmentsByDebtId.get(debt.id) ?? [])
      .filter((installment) => !installment.isPaid)
      .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
    if (!nextUnpaid) continue;

    const dueDate = dateForDayInMonth(nextUnpaid.referenceMonth, debt.dueDay!);
    const daysUntilDue = daysBetween(today, dueDate);
    if (daysUntilDue > DEBT_REMINDER_WINDOW_DAYS) continue;

    const key = `debt:${debt.id}:${nextUnpaid.installmentNumber}`;
    if (await wasReminderSent(key)) continue;

    const recipients = debt.ownerUserId
      ? membersById.has(debt.ownerUserId)
        ? [membersById.get(debt.ownerUserId)!]
        : []
      : members;

    const dueLabel = dueLabelFor(daysUntilDue);

    const sent = await sendToMembers(
      recipients,
      `Parcela de "${debt.name}" ${dueLabel}`,
      `
        <h1 style="font-size: 20px;">Parcela chegando</h1>
        <p>A parcela ${nextUnpaid.installmentNumber}/${debt.installmentsCount} de <strong>${debt.name}</strong>
        (${formatBRL(Number(nextUnpaid.amount))}) ${dueLabel} (${formatBRDate(dueDate)}) e ainda não foi paga.</p>
        <p>Dá uma olhada no PAR. pra marcar como paga.</p>
      `
    );
    if (sent > 0) {
      emailsSent += sent;
      await markReminderSent(key, {
        groupId,
        kind: "debt",
        debtId: debt.id,
        installmentNumber: nextUnpaid.installmentNumber,
        dueDate,
      });
    }
  }

  return emailsSent;
}

async function runBudgetReminder(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const { periodMonth, monthStart, monthEnd } = parseMonthRange();
  const budget = await findGroupBudget(groupId, periodMonth);
  if (!budget) return 0;

  const cap = Number(budget.capAmount);
  const spent = await getMonthlyExpenseTotal(groupId, monthStart, monthEnd);
  if (spent <= cap) return 0;

  const key = `budget:${groupId}:${periodMonth}`;
  if (await wasReminderSent(key)) return 0;

  const sent = await sendToMembers(
    members,
    "Orçamento do mês estourado",
    `
      <h1 style="font-size: 20px;">Orçamento estourado</h1>
      <p>O grupo já gastou <strong>${formatBRL(spent)}</strong> este mês, passando do limite de ${formatBRL(cap)}.</p>
      <p>Vale dar uma olhada nos Relatórios pra ver onde foi o gasto.</p>
    `,
    "/reports"
  );
  if (sent > 0) {
    await markReminderSent(key, { groupId, kind: "budget", periodMonth, spent, cap });
  }
  return sent;
}

// Contas fixas lançam sozinhas no dia, mas um aviso alguns dias antes ajuda a
// garantir que o dinheiro está lá. Um email por conta por mês.
const RECURRING_REMINDER_WINDOW_DAYS = 3;

async function runRecurringBillReminders(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = todayInBrazil();
  const thisMonth = today.slice(0, 7);
  const bills = (await findRecurringBillsByGroupId(groupId)).filter(
    (bill) => bill.isActive && bill.transactionType === "expense"
  );
  let emailsSent = 0;

  for (const bill of bills) {
    const month = bill.lastGeneratedMonth === thisMonth ? addMonths(thisMonth, 1) : thisMonth;
    const dueDate = dateForDayInMonth(month, bill.dayOfMonth);
    const daysUntilDue = daysBetween(today, dueDate);
    if (daysUntilDue < 0 || daysUntilDue > RECURRING_REMINDER_WINDOW_DAYS) continue;

    const key = `recurring:${bill.id}:${month}`;
    if (await wasReminderSent(key)) continue;

    const recipients = bill.accountOwnerId
      ? membersById.has(bill.accountOwnerId)
        ? [membersById.get(bill.accountOwnerId)!]
        : []
      : members;
    const sent = await sendToMembers(
      recipients,
      `Conta fixa "${bill.description}" ${dueLabelFor(daysUntilDue)}`,
      `
        <h1 style="font-size: 20px;">Conta fixa chegando</h1>
        <p><strong>${escapeHtml(bill.description)}</strong> (${formatBRL(Number(bill.amount))}) ${dueLabelFor(daysUntilDue)} (${formatBRDate(dueDate)}).</p>
        <p>O PAR. lança sozinho no dia. Só confira se tem saldo.</p>
      `
    );
    if (sent > 0) {
      emailsSent += sent;
      await markReminderSent(key, { groupId, kind: "recurring", billId: bill.id, month, dueDate });
    }
  }
  return emailsSent;
}

// A receber: no dia do prazo (ou na primeira execução depois dele), avisa
// quem emprestou que é hora de receber. Uma vez por empréstimo por prazo --
// mudar o prazo gera um lembrete novo.
async function runLoanReminders(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = todayInBrazil();
  const loans = await findLoansByGroup(groupId);
  let emailsSent = 0;

  for (const loan of loans) {
    if (loan.status !== "open" || !loan.dueDate || loan.dueDate > today) continue;
    const remaining = Number(loan.remaining);
    if (remaining <= 0) continue;
    const key = `loan:${loan.id}:${loan.dueDate}`;
    if (await wasReminderSent(key)) continue;
    const lender = membersById.get(loan.ownerUserId);
    if (!lender) continue;

    const days = daysBetween(loan.dueDate, today);
    const when = days === 0 ? "hoje" : `há ${days} dia${days === 1 ? "" : "s"}`;
    // "Eu devo": o lembrete é pra quem pegou emprestado devolver.
    const sent = loan.direction === "borrowed"
      ? await sendToMembers(
          [lender],
          `Prazo pra devolver ${formatBRL(remaining)} pra ${loan.personName}${when === "hoje" ? " é hoje" : ""}`,
          `
        <h1 style="font-size: 20px;">Prazo de empréstimo</h1>
        <p>O prazo que você combinou pra devolver <strong>${formatBRL(remaining)}</strong> pra <strong>${escapeHtml(loan.personName)}</strong> foi ${when} (${formatBRDate(loan.dueDate)}).</p>
        <p>Já pagou? Toque em "Paguei" em Contas &gt; Empréstimos &gt; Eu devo, no PAR.</p>
      `,
          "/loans?lado=devo"
        )
      : await sendToMembers(
      [lender],
      `${loan.personName} tinha que devolver ${formatBRL(remaining)} ${when === "hoje" ? "hoje" : ""}`.trim(),
      `
        <h1 style="font-size: 20px;">Prazo de empréstimo</h1>
        <p>O prazo de <strong>${escapeHtml(loan.personName)}</strong> devolver <strong>${formatBRL(remaining)}</strong> foi ${when} (${formatBRDate(loan.dueDate)}).</p>
        <p>Recebeu? Toque em "Recebi" em Contas &gt; Empréstimos, no PAR.</p>
      `,
      "/loans"
    );
    if (sent > 0) {
      emailsSent += sent;
      await markReminderSent(key, { groupId, kind: "loan", loanId: loan.id, dueDate: loan.dueDate });
    }
  }
  return emailsSent;
}

const MONTH_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

// Fechamento do mês: nos primeiros dias do mês (dia 1, ou nos seguintes se o
// servidor estava dormindo), cada pessoa recebe o resumo do mês que acabou --
// os números dela, não os do grupo. Uma vez por pessoa por mês; quem não
// lançou nada no mês não recebe.
const MONTH_CLOSE_LAST_DAY = 5;

async function runMonthCloseEmails(groupId: string, members: MemberWithEmail[], now = new Date()): Promise<number> {
  const dayOfMonth = Number(todayInBrazil(now).slice(8, 10));
  if (dayOfMonth > MONTH_CLOSE_LAST_DAY) return 0;
  const month = previousMonthInBrazil(now);
  let emailsSent = 0;

  for (const member of members) {
    if (!member.email) continue;
    const key = `month-close:${member.id}:${month}`;
    if (await wasReminderSent(key)) continue;
    const close = await getMonthCloseForUser(member.id, month);
    if (!close.hasActivity) continue;

    const name = monthName(month);
    const leftColor = close.left < 0 ? "#d03b3b" : "#16171d";
    const diff = close.left - close.previousLeft;
    const comparison =
      close.previousIncome > 0 || close.previousExpense > 0
        ? `<p style="color:#5b5d68;">Em ${monthName(close.previousMonth)} sobrou ${formatBRL(close.previousLeft)}. Agora foram ${
            diff >= 0 ? `${formatBRL(diff)} a mais` : `${formatBRL(-diff)} a menos`
          }.</p>`
        : "";
    const categories = close.topCategories.length
      ? `<p style="margin-bottom:4px;"><strong>Onde mais foi dinheiro</strong></p><ul style="margin-top:0;padding-left:18px;">${close.topCategories
          .map((row) => `<li>${escapeHtml(row.name)}: ${formatBRL(row.total)}</li>`)
          .join("")}</ul>`
      : "";
    const sent = await sendToMembers(
      [member],
      `Fechamento de ${name}: sobrou ${formatBRL(close.left)}`,
      `
        <h1 style="font-size: 20px;">Fechamento de ${name}</h1>
        <table style="border-collapse:collapse;margin:8px 0 12px;">
          <tr><td style="padding:2px 16px 2px 0;color:#5b5d68;">Entrou</td><td style="text-align:right;"><strong>${formatBRL(close.income)}</strong></td></tr>
          <tr><td style="padding:2px 16px 2px 0;color:#5b5d68;">Saiu</td><td style="text-align:right;"><strong>${formatBRL(close.expense)}</strong></td></tr>
          <tr><td style="padding:2px 16px 2px 0;color:#5b5d68;">Sobrou</td><td style="text-align:right;color:${leftColor};"><strong>${formatBRL(close.left)}</strong></td></tr>
        </table>
        ${comparison}
        ${categories}
        <p>O detalhe está em Relatórios, no PAR.</p>
      `,
      "/reports"
    );
    if (sent > 0) {
      emailsSent += sent;
      await markReminderSent(key, { groupId, kind: "month-close", userId: member.id, month });
    }
  }
  return emailsSent;
}

// Entry point for the daily cron (POST /api/reminders/run). Generates the
// whole batch of due reminders across every group in one pass -- there's no
// per-user request context here, unlike everything else in the app.
export async function runDueReminders(): Promise<{ groupsChecked: number; emailsSent: number }> {
  const groups = await findAllGroupIds();
  let emailsSent = 0;

  for (const group of groups) {
    const members = await findMembersWithEmailByGroupId(group.id);
    if (members.length === 0) continue;
    emailsSent += await runCardReminders(group.id, members);
    emailsSent += await runDebtReminders(group.id, members);
    emailsSent += await runBudgetReminder(group.id, members);
    emailsSent += await runRecurringBillReminders(group.id, members);
    emailsSent += await runLoanReminders(group.id, members);
    emailsSent += await runMonthCloseEmails(group.id, members);
  }

  return { groupsChecked: groups.length, emailsSent };
}

// Rede de segurança pro cron diário: o primeiro ping de health depois das 8h
// (Brasília) de cada dia reserva a execução do dia no Firestore -- create()
// falha se outra instância já reservou -- e faz o mesmo que POST
// /api/reminders/run. Tudo lá dentro já evita duplicidade sozinho
// (reminderLogs, lastGeneratedMonth), então o cron rodar também não faz mal.
let lastClaimedDay: string | null = null;

export async function maybeRunDailyJobs(now = new Date()): Promise<void> {
  const today = todayInBrazil(now);
  if (lastClaimedDay === today) return;
  const hourInBrazil = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }).format(now)
  );
  if (hourInBrazil < 8) return;
  lastClaimedDay = today;
  try {
    await claimDailyRun(today);
  } catch {
    return; // already claimed today (here or on another instance)
  }
  try {
    const [reminders, recurringBills] = await Promise.all([runDueReminders(), generateDueRecurringBills()]);
    console.log("[daily jobs]", today, JSON.stringify({ reminders, recurringBills }));
    // Os jobs lançam contas fixas e marcam lembretes: o que estava em cache
    // pode ter ficado velho.
    invalidateAllReads();
  } catch (err) {
    logError("daily-jobs", err);
  }
}
