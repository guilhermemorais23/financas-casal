import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { consumeLinkCode, findLinkByChatId, saveLink, saveLinkCode } from "./assistant.repository";
import { sendTelegramMessage, type TelegramAudio } from "./telegram.client";
import { findVisibleCategories } from "../categories/categories.repository";
import { findAccountsByGroupId, findMembersByGroupId } from "../groups/groups.repository";
import { createTransaction } from "../transactions/transactions.service";

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
  intent: "log_expense" | "log_income" | "chat";
  description?: string;
  amount?: number;
  categoryName?: string | null;
  reply?: string;
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

  const { userId, groupId } = link;
  const [accounts, categories] = await Promise.all([
    findAccountsByGroupId(groupId),
    findVisibleCategories(groupId),
  ]);
  const personalAccount = accounts.find((account) => account.type === "personal" && account.ownerUserId === userId);
  const categoryNames = categories.map((category) => category.name).join(", ");

  const prompt = `Você é o assistente financeiro do app PAR. (finanças de casal), conversando por mensagem. Categorias disponíveis: ${categoryNames || "nenhuma cadastrada"}.
${audio ? "A mensagem do usuário é um áudio -- transcreva mentalmente e entenda a intenção." : `Mensagem do usuário: "${text}"`}

Responda APENAS com um JSON puro (sem markdown, sem texto fora do JSON), em um destes formatos:
{"intent":"log_expense","description":"...","amount":123.45,"categoryName":"uma categoria da lista ou null"}
{"intent":"log_income","description":"...","amount":123.45}
{"intent":"chat","reply":"resposta curta, direta, em português do Brasil"}

Use "log_expense"/"log_income" quando a pessoa relata um gasto ou recebimento real (ex: "gastei 50 no mercado", "recebi 200 de salário"). Use "chat" pra perguntas, conversa ou qualquer coisa que não seja um lançamento -- responda a pergunta da melhor forma possível no campo "reply".`;

  let raw: string;
  try {
    raw = await askGemini(prompt, audio);
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      await sendTelegramMessage(chatId, "O assistente de IA ainda não foi configurado no servidor.");
      return;
    }
    throw err;
  }

  const parsed = parseAssistantReply(raw);
  if (!parsed) {
    await sendTelegramMessage(chatId, raw || "Não entendi, pode repetir?");
    return;
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
    await sendTelegramMessage(
      chatId,
      `${emoji} Registrado: ${transaction.description} — R$ ${parsed.amount.toFixed(2)}${category ? ` (${category.name})` : ""}.`
    );
    return;
  }

  await sendTelegramMessage(chatId, parsed.reply || "Prontinho.");
}
