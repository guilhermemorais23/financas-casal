import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { consumeLinkCode, findLinkByChatId, saveLink, saveLinkCode } from "./assistant.repository";
import { sendTelegramMessage, type TelegramAudio } from "./telegram.client";
import { getCurrentBudget } from "../budgets/budgets.service";
import { findVisibleCategories } from "../categories/categories.repository";
import { listDebts } from "../debts/debts.service";
import { listGoals } from "../goals/goals.service";
import { findAccountsByGroupId, findGroupById, updateGroupFinancialProfile } from "../groups/groups.repository";
import { requireGroupId } from "../groups/groups.service";
import { getMonthlySummary } from "../transactions/transactions.repository";
import { createTransaction } from "../transactions/transactions.service";
import { currentMonthParam, parseMonthRange } from "../../utils/month";

export class AssistantNotConfiguredError extends Error {}

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Codes expire quickly -- they only need to survive the few seconds between
// tapping "gerar código" in the app and pasting it into the bot.
const LINK_CODE_TTL_MS = 10 * 60 * 1000;

export async function createTelegramLinkCode(userId: string, groupId: string): Promise<string> {
  const code = randomCode();
  await saveLinkCode(code, userId, groupId, Date.now() + LINK_CODE_TTL_MS);
  return code;
}

interface AssistantReply {
  intent: "log_expense" | "log_income" | "set_financial_goal" | "set_savings" | "chat";
  description?: string;
  amount?: number;
  categoryName?: string | null;
  goalText?: string;
  reply?: string;
}

interface FinanceContext {
  text: string;
  financialGoal: string | null;
  savingsAmount: number | null;
}

// Grounds every reply in the couple's real numbers -- without this, the
// model has nothing but category *names* (for expense-logging) and answers
// financial questions purely from guesswork, which reads as confident but
// can invent things (a "subscription" that doesn't exist).
async function buildFinanceContext(userId: string, groupId: string): Promise<FinanceContext> {
  const month = currentMonthParam();
  const { monthStart, monthEnd } = parseMonthRange(month);

  const [summary, budget, debts, goals, group] = await Promise.all([
    getMonthlySummary(groupId, userId, monthStart, monthEnd, "visible"),
    getCurrentBudget(userId, month),
    listDebts(userId),
    listGoals(userId),
    findGroupById(groupId),
  ]);

  const categoriesText = summary.byCategory.length
    ? summary.byCategory.map((row) => `${row.categoryName ?? "Sem categoria"}: R$ ${row.total}`).join("; ")
    : "nenhum gasto registrado ainda este mês";

  const debtsText = debts.length
    ? debts.map((debt) => `${debt.name}: R$ ${debt.remainingAmount.toFixed(2)} restante`).join("; ")
    : "nenhuma dívida cadastrada";

  const openGoals = goals.filter((goal) => !goal.achievedAt);
  const goalsText = openGoals.length
    ? openGoals.map((goal) => `${goal.name}: R$ ${goal.currentAmount} guardado de R$ ${goal.targetAmount}`).join("; ")
    : "nenhuma meta de economia cadastrada";

  const budgetText = budget.budget
    ? `teto de R$ ${budget.budget.capAmount}, já gasto R$ ${budget.spent.toFixed(2)} dentro desse teto`
    : "nenhum orçamento definido para este mês";

  const financialGoal = group?.financialGoal ?? null;
  const savingsAmount = group?.savingsAmount ?? null;

  const text = `Dados reais de ${month} (use SOMENTE estes números -- nunca invente gasto, categoria, dívida ou meta que não esteja listada aqui):
Objetivo financeiro do casal: ${financialGoal ?? "ainda não informado"}.
Reserva/poupança guardada: ${savingsAmount === null ? "ainda não informada" : `R$ ${savingsAmount.toFixed(2)}`}.
Gastos por categoria: ${categoriesText}. Total do mês: R$ ${summary.total}.
Orçamento: ${budgetText}.
Dívidas em aberto: ${debtsText}.
Metas de economia: ${goalsText}.`;

  return { text, financialGoal, savingsAmount };
}

async function askGemini(prompt: string, audio?: TelegramAudio): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AssistantNotConfiguredError();

  const parts: Part[] = [{ text: prompt }];
  if (audio) parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.base64 } });

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(parts);
  return result.response.text().trim();
}

function parseAssistantReply(raw: string): AssistantReply | null {
  const cleaned = raw.replace(/^```json\s*|```$/g, "").trim();
  try {
    return JSON.parse(cleaned) as AssistantReply;
  } catch {
    return null;
  }
}

// Shared by every channel (Telegram, the in-app chat widget) -- same
// grounding, same intent schema, same behavior. Only how the reply gets
// delivered differs per caller.
async function processAssistantMessage(
  userId: string,
  groupId: string,
  text: string | undefined,
  audio: TelegramAudio | undefined
): Promise<string> {
  const [accounts, categories, financeContext] = await Promise.all([
    findAccountsByGroupId(groupId),
    findVisibleCategories(groupId),
    buildFinanceContext(userId, groupId),
  ]);
  const personalAccount = accounts.find((account) => account.type === "personal" && account.ownerUserId === userId);
  const categoryNames = categories.map((category) => category.name).join(", ");

  const missingProfile =
    financeContext.financialGoal === null && financeContext.savingsAmount === null
      ? "\nO casal ainda não te contou o objetivo financeiro nem quanto tem guardado -- se a mensagem não for um lançamento nem já responder isso, pergunte de forma natural (uma coisa de cada vez) qual é o objetivo financeiro deles e quanto eles têm guardado hoje de reserva."
      : "";

  const prompt = `Você é o assistente financeiro do app PAR. (finanças de casal), conversando por mensagem. Categorias disponíveis pra lançamento: ${categoryNames || "nenhuma cadastrada"}.

${financeContext.text}
${missingProfile}

${audio ? "A mensagem do usuário é um áudio -- transcreva mentalmente e entenda a intenção." : `Mensagem do usuário: "${text}"`}

Responda APENAS com um JSON puro (sem markdown, sem texto fora do JSON), em um destes formatos:
{"intent":"log_expense","description":"...","amount":123.45,"categoryName":"uma categoria da lista ou null"}
{"intent":"log_income","description":"...","amount":123.45}
{"intent":"set_financial_goal","goalText":"o objetivo descrito pela pessoa, resumido em 1 frase"}
{"intent":"set_savings","amount":123.45}
{"intent":"chat","reply":"resposta curta, direta, em português do Brasil, baseada SOMENTE nos dados reais acima"}

Use "log_expense"/"log_income" quando a pessoa relata um gasto ou recebimento real (ex: "gastei 50 no mercado", "recebi 200 de salário"). Use "set_financial_goal" quando a pessoa disser qual é o objetivo financeiro dela (ex: "quero quitar minhas dívidas até dezembro", "meu objetivo é juntar pra uma viagem"). Use "set_savings" quando ela disser quanto já tem guardado/reserva (ex: "tenho 5000 guardado"). Use "chat" pra perguntas, conversa, pedido de análise ou qualquer coisa que não seja um lançamento -- responda com base nos dados reais acima, nunca invente um gasto/categoria/dívida que não esteja listado. Se fizer sentido, termine com uma pergunta curta pra entender melhor o que a pessoa quer (ex: se não há meta cadastrada, pergunte se ela quer criar uma; se há dívida em aberto, pergunte se o foco agora é pagar ela ou economizar mais primeiro).`;

  const raw = await askGemini(prompt, audio);
  const parsed = parseAssistantReply(raw);
  if (!parsed) {
    return raw || "Não entendi, pode repetir?";
  }

  if ((parsed.intent === "log_expense" || parsed.intent === "log_income") && personalAccount && parsed.amount) {
    const category = categories.find(
      (candidate) => candidate.name.toLowerCase() === parsed.categoryName?.toLowerCase()
    );
    const transaction = await createTransaction(userId, {
      accountId: personalAccount.id,
      categoryId: category?.id ?? null,
      payerId: userId,
      description: parsed.description || "Lançamento via assistente",
      amount: parsed.amount,
      transactionType: parsed.intent === "log_expense" ? "expense" : "income",
      occurredAt: new Date().toISOString().slice(0, 10),
      isPrivate: false,
      splitType: "none",
    });
    const emoji = parsed.intent === "log_expense" ? "💸" : "💰";
    return `${emoji} Registrado: ${transaction.description} — R$ ${parsed.amount.toFixed(2)}${category ? ` (${category.name})` : ""}.`;
  }

  if (parsed.intent === "set_financial_goal" && parsed.goalText) {
    await updateGroupFinancialProfile(groupId, { financialGoal: parsed.goalText });
    return `Anotado! Objetivo: "${parsed.goalText}". Vou levar isso em conta nas próximas análises.`;
  }

  if (parsed.intent === "set_savings" && parsed.amount !== undefined) {
    await updateGroupFinancialProfile(groupId, { savingsAmount: parsed.amount });
    return `Anotado! Vocês têm R$ ${parsed.amount.toFixed(2)} guardado.`;
  }

  return parsed.reply || "Prontinho.";
}

async function handleLinking(chatId: string, text: string | undefined): Promise<void> {
  const code = text?.trim().toUpperCase();
  const redeemed = code ? await consumeLinkCode(code) : null;

  if (redeemed) {
    await saveLink(chatId, redeemed.userId, redeemed.groupId);
    await sendTelegramMessage(
      chatId,
      "Conta vinculada! Agora você pode me contar seus gastos (\"gastei 50 no mercado\") ou perguntar sobre suas finanças por aqui."
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    "Ainda não te conheço. No app PAR., vá em Conta → assistente e gere um código, depois me envie ele aqui."
  );
}

export async function handleTelegramMessage(
  chatId: string,
  text: string | undefined,
  audio: TelegramAudio | undefined
): Promise<void> {
  const link = await findLinkByChatId(chatId);
  if (!link) {
    await handleLinking(chatId, text);
    return;
  }

  try {
    const reply = await processAssistantMessage(link.userId, link.groupId, text, audio);
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      await sendTelegramMessage(chatId, "O assistente de IA ainda não foi configurado no servidor.");
      return;
    }
    throw err;
  }
}

// Same assistant, reached from the in-app chat widget instead of Telegram --
// the caller is already an authenticated PAR. user, so no link/code step.
export async function answerAssistantMessage(userId: string, message: string): Promise<string> {
  const groupId = await requireGroupId(userId);
  return processAssistantMessage(userId, groupId, message, undefined);
}
