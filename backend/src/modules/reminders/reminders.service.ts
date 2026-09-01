import { findCardsByGroupId, findStatement } from "../cards/cards.repository";
import { currentStatementMonth, dueDateFor } from "../cards/cards.service";
import { findGroupBudget, getMonthlyExpenseTotal } from "../budgets/budgets.repository";
import { sendReminderEmail } from "../../email/mailer";
import { daysBetween, parseMonthRange } from "../../utils/month";
import {
  findAllGroupIds,
  findMembersWithEmailByGroupId,
  markReminderSent,
  wasReminderSent,
  type MemberWithEmail,
} from "./reminders.repository";

// A card's due-date reminder fires the first time the cron notices its
// current statement is unpaid and within this many days of (or already
// past) the due date -- one email per statement, not one per day in range.
const CARD_REMINDER_WINDOW_DAYS = 3;

function formatBRDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function formatBRL(amount: number): string {
  return amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function sendToMembers(members: MemberWithEmail[], subject: string, bodyHtml: string): Promise<number> {
  const withEmail = members.filter((member) => member.email);
  await Promise.all(withEmail.map((member) => sendReminderEmail(member.email!, subject, bodyHtml)));
  return withEmail.length;
}

async function runCardReminders(groupId: string, members: MemberWithEmail[]): Promise<number> {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const today = new Date().toISOString().slice(0, 10);
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

    const dueLabel =
      daysUntilDue === 0
        ? "vence hoje"
        : daysUntilDue > 0
          ? `vence em ${daysUntilDue} dia${daysUntilDue === 1 ? "" : "s"}`
          : `venceu há ${-daysUntilDue} dia${-daysUntilDue === 1 ? "" : "s"}`;

    const sent = await sendToMembers(
      recipients,
      `Fatura do cartão "${card.name}" ${dueLabel}`,
      `
        <h1 style="font-size: 20px;">💳 Fatura chegando</h1>
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
      <h1 style="font-size: 20px;">📊 Orçamento estourado</h1>
      <p>O grupo já gastou <strong>${formatBRL(spent)}</strong> este mês, passando do limite de ${formatBRL(cap)}.</p>
      <p>Vale dar uma olhada nos Relatórios pra ver onde foi o gasto.</p>
    `
  );
  if (sent > 0) {
    await markReminderSent(key, { groupId, kind: "budget", periodMonth, spent, cap });
  }
  return sent;
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
    emailsSent += await runBudgetReminder(group.id, members);
  }

  return { groupsChecked: groups.length, emailsSent };
}
