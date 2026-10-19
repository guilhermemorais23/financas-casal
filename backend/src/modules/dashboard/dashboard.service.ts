import { getAlertsForUser, type AlertItem } from "../alerts/alerts.service";
import { getGroupForUser } from "../groups/groups.service";
import { listDebts } from "../debts/debts.service";
import { getCategoryBudgets, getCurrentBudget } from "../budgets/budgets.service";
import { listGoals } from "../goals/goals.service";
import { listCards, owedOnCardsCents, savedInSecuredCardsCents } from "../cards/cards.service";
import {
  getBalance,
  getDailySeriesForUser,
  getMonthlySummaryForUser,
  getMonthlyTrendForUser,
  listTransactions,
} from "../transactions/transactions.service";
import { addMonths, currentMonthParam, parseMonthRange } from "../../utils/month";
import { findOwnDocsForRange } from "../transactions/transactions.repository";
import { requireGroupId } from "../groups/groups.service";
import { listLoans } from "../loans/loans.service";
import { getUpcomingForUser } from "../upcoming/upcoming.service";

export interface GoalHighlight {
  id: string;
  name: string;
  emoji: string | null;
  currentAmount: string;
  targetAmount: string;
}

// A meta mais perto de terminar entre as que ainda não foram atingidas --
// é onde guardar dinheiro agora faz diferença, em vez de mostrar a mais nova
// ou uma qualquer.
// photoDataUrl fica de fora de propósito: é uma imagem em base64, e a
// resposta do Painel já junta mais de 10 coisas numa resposta só.
function pickGoalHighlight(goals: Awaited<ReturnType<typeof listGoals>>): GoalHighlight | null {
  const open = goals.filter((goal) => !goal.achievedAt);
  if (open.length === 0) return null;
  const best = open.reduce((closest, goal) => {
    const goalPercent = Number(goal.currentAmount) / Number(goal.targetAmount);
    const closestPercent = Number(closest.currentAmount) / Number(closest.targetAmount);
    return goalPercent > closestPercent ? goal : closest;
  });
  return {
    id: best.id,
    name: best.name,
    emoji: best.emoji,
    currentAmount: best.currentAmount,
    targetAmount: best.targetAmount,
  };
}

export interface NextInvoice {
  cardName: string;
  dueDate: string;
  total: string;
  limit: string | null;
  limitUsed: string | null;
  // open: tem fatura a pagar (a atual ou, se ela já foi paga, a próxima com
  // parcelas). paid / empty: nada a pagar agora -- o cartão continua no
  // Painel pra mostrar o limite.
  status: "open" | "paid" | "empty";
}

// A fatura a pagar mais próxima entre todos os cartões. Sem nenhuma em
// aberto, o cartão continua aparecendo (com o limite): antes o widget sumia
// do Painel logo depois de pagar a fatura ou quando o ciclo virava sem
// compras.
export function pickNextInvoice(cards: Awaited<ReturnType<typeof listCards>>): NextInvoice | null {
  if (cards.length === 0) return null;
  const options = cards.map((card) => {
    const statement = card.currentStatement;
    const base = { cardName: card.name, limit: card.limit, limitUsed: card.limitUsed };
    if (!statement.isPaid && Number(statement.total) > 0) {
      return { ...base, dueDate: statement.dueDate, total: statement.total, status: "open" as const };
    }
    // Atual paga (ou vazia), mas com parcelas de outro mês em aberto.
    const nextRelease = [...card.limitReleases]
      .filter((release) => release.month !== statement.month && Number(release.amount) > 0)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (nextRelease) {
      return { ...base, dueDate: nextRelease.dueDate, total: nextRelease.amount, status: "open" as const };
    }
    return { ...base, dueDate: statement.dueDate, total: "0.00", status: statement.isPaid ? ("paid" as const) : ("empty" as const) };
  });
  const open = options.filter((option) => option.status === "open").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  // Nada em aberto: o cartão com limite (é o que mais interessa ver), senão o primeiro.
  return open[0] ?? options.find((option) => option.limit !== null) ?? options[0];
}

export { InvalidMonthError } from "../../utils/month";

// Tudo que a DashboardPage precisa, numa chamada só. O frontend fazia 7
// pedidos separados (um por card/widget) -- cada um pagava a sua ida e volta
// E a sua conferência de token do Firebase, o que custa de verdade, mesmo
// com as leituras do Firestore já rodando em paralelo no navegador. Juntar
// no servidor transforma "N idas ao mesmo lugar" em 1, e as leituras abaixo
// continuam rodando ao mesmo tempo via Promise.all, como antes.
// Saldo do mês dia a dia, com a mesma conta do número grande do Painel
// (conta pessoal: entrou - saiu - guardado - emprestado). Um ponto por dia do
// mês, acumulado.
async function personalDailyBalance(userId: string, month: string): Promise<{ day: string; balance: number }[]> {
  const groupId = await requireGroupId(userId);
  const rows = await findOwnDocsForRange(groupId, userId, `${month}-01`, `${addMonths(month, 1)}-01`);
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.isAccountsTransfer) continue;
    const delta = row.transactionType === "income" ? row.amountCents : -row.amountCents;
    byDay.set(row.date, (byDay.get(row.date) ?? 0) + delta);
  }
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  let running = 0;
  const points: { day: string; balance: number }[] = [];
  for (let d = 1; d <= days; d++) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    running += byDay.get(day) ?? 0;
    points.push({ day, balance: running / 100 });
  }
  return points;
}

export async function getDashboardForUser(userId: string, monthParam?: string) {
  const groupResult = await getGroupForUser(userId);
  if (!groupResult) return null;

  // O parseMonthRange valida o monthParam e dá o padrão (o mês de hoje),
  // igualzinho a toda rota que recebe ?month= -- o periodMonth vem como
  // "YYYY-MM-01" e é cortado aqui pro "YYYY-MM" que as outras funções do
  // service (e o addMonths) esperam.
  const { periodMonth } = parseMonthRange(monthParam);
  const month = periodMonth.slice(0, 7);
  // Os alertas (ritmo do orçamento, picos por categoria, vencimentos chegando)
  // são sempre sobre *hoje*, não sobre o mês que o Painel está mostrando --
  // calcular isso olhando março não faz sentido, então só são buscados quando
  // `month` é o mês atual de verdade.
  const isCurrentMonth = month === currentMonthParam();

  const [recent, debts, summary, jointSummary, balance, budget, categoryBudgets, dailyTrend, goals, cards, trend6m, alerts, loans, upcoming] =
    await Promise.all([
      listTransactions(userId, 8, month),
      listDebts(userId),
      getMonthlySummaryForUser(userId, month, "visible"),
      // "joint": só o que saiu da "Nossa Conta" neste mês, por quem pagou --
      // alimenta o card compacto "Par" do Painel (o `summary` acima, que usa o
      // escopo "visible", mistura também os gastos pessoais de quem pediu, e isso
      // não é "quanto cada um pôs na conta conjunta").
      getMonthlySummaryForUser(userId, month, "joint"),
      // "Quem deve quem" acumulado de todos os gastos divididos igualmente desde
      // sempre (não só deste mês -- ainda não existe ação de "acertar as contas",
      // então vai somando como uma conta corrente até alguém pagar fora do app e
      // ajustar à mão). Existia no backend fazia tempo sem nenhuma tela mostrando.
      getBalance(userId),
      getCurrentBudget(userId, month),
      getCategoryBudgets(userId, month),
      getDailySeriesForUser(userId, month, "visible"),
      listGoals(userId),
      listCards(userId),
      // 6 meses terminando em `month` -- também traz o total de entrada e saída
      // pessoal deste mês e do anterior (ver getMonthlyTrendForUser), então o card
      // principal abaixo não precisa mais de duas buscas de 100 linhas só pra
      // somar dois números cada.
      getMonthlyTrendForUser(userId, month),
      isCurrentMonth ? getAlertsForUser(userId, { includeDue: false }) : Promise.resolve<AlertItem[]>([]),
      listLoans(userId),
      getUpcomingForUser(userId),
    ]);

  // A janela do trend6m sempre inclui os dois (monthsBack é 6 por padrão,
  // nunca é chamado aqui com menos de 2) -- o último item é o próprio `month`,
  // e o anterior a ele é o mês passado.
  const currentMonthTotals = trend6m[trend6m.length - 1];
  const prevMonthTotals = trend6m[trend6m.length - 2];

  // Dinheiro guardado em cartões com limite garantido -- saiu das contas
  // (guardar é transferência), mas continua sendo da pessoa, então o "Seu
  // dinheiro" do Painel soma de volta.
  const savedInSecuredCards = savedInSecuredCardsCents(cards);

  return {
    group: { accounts: groupResult.accounts, members: groupResult.members },
    savedInSecuredCards: savedInSecuredCards / 100,
    // Faturas e parcelas de cartão ainda em aberto -- o Painel tira isso (e
    // as dívidas) pra mostrar "depois de pagar o que deve".
    owedOnCards: owedOnCardsCents(cards) / 100,
    // Empréstimos: o que ainda vai voltar -- "Seu dinheiro" mostra isso como
    // "quando receber tudo" em cima do que está nas contas.
    loansSummary: loans.summary,
    // "Eu devo": o que você pegou emprestado e ainda vai devolver.
    owedSummary: loans.owedSummary,
    // "Vence logo": pagar e receber nos próximos 7 dias (e atrasados).
    upcoming,
    recent,
    debts,
    summary,
    jointSummary,
    balance,
    budget,
    categoryBudgets,
    dailyTrend,
    personalMonthTotals: {
      income: currentMonthTotals.income,
      expense: currentMonthTotals.expense,
      savedInCards: currentMonthTotals.savedInCards,
    },
    personalPrevMonthTotals: { income: prevMonthTotals.income, expense: prevMonthTotals.expense },
    goalHighlight: pickGoalHighlight(goals),
    nextInvoice: pickNextInvoice(cards),
    heroDaily: await personalDailyBalance(userId, month),
    // Painel novo: todos os cartões com o limite, as metas (sem a foto) e o
    // total guardado nelas.
    cardsSummary: cards.map((card) => ({
      id: card.id,
      name: card.name,
      limit: card.limit,
      limitUsed: card.limitUsed,
      limitType: card.limitType,
      statementTotal: card.currentStatement.total,
      statementIsPaid: card.currentStatement.isPaid,
      dueDate: card.currentStatement.dueDate,
    })),
    goalsSummary: goals
      .filter((goal) => !goal.achievedAt)
      .slice(0, 4)
      .map((goal) => ({
        id: goal.id,
        name: goal.name,
        currentAmount: goal.currentAmount,
        targetAmount: goal.targetAmount,
        deadline: goal.deadline,
        itemsCount: goal.items?.length ?? 0,
      })),
    savedInGoals: goals.reduce((sum, goal) => sum + Math.round(Number(goal.currentAmount) * 100), 0) / 100,
    trend6m,
    alerts,
  };
}
