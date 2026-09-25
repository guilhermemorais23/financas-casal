import { escapeHtml, sendEmail, sendOwnerEmail } from "../../email/mailer";
import { findUserById } from "../users/users.repository";
import {
  addMessage,
  findThread,
  listMessages,
  listThreads,
  markRead,
  type FeedbackKind,
  type FeedbackMessage,
  type FeedbackThread,
} from "./feedback.repository";

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  idea: "💡 Ideia",
  problem: "🐞 Problema",
  praise: "💜 Elogio",
};

// The instant "we got it" reply, per kind. Sent on a conversation's first
// message and again when someone comes back after a quiet spell, never on
// every message of a back-and-forth.
const AUTO_REPLIES: Record<FeedbackKind, string> = {
  idea: "Obrigado pela ideia! Ela chegou pra gente e vamos te responder por aqui.",
  problem: "Obrigado por avisar! Já recebemos e vamos te responder por aqui o quanto antes.",
  praise: "Que bom ler isso! Obrigado pelo carinho, ele chegou pra gente.",
};
const AUTO_REPLY_GAP_MS = 12 * 60 * 60 * 1000;

export const MAX_MESSAGE_LENGTH = 2000;

export class ThreadNotFoundError extends Error {}

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.ALLOWED_ORIGIN?.split(",")[0] ?? "https://par-projeto.web.app").trim();
}

async function whoIs(userId: string, fallbackEmail: string) {
  const user = await findUserById(userId);
  return { email: user?.email ?? fallbackEmail, displayName: user?.displayName ?? fallbackEmail };
}

export async function getMyConversation(userId: string): Promise<{ messages: FeedbackMessage[] }> {
  const [messages] = await Promise.all([listMessages(userId), markRead(userId, "user")]);
  return { messages };
}

export async function getMyUnread(userId: string): Promise<number> {
  return (await findThread(userId))?.unreadForUser ?? 0;
}

export async function sendUserMessage(
  userId: string,
  fallbackEmail: string,
  input: { kind: FeedbackKind; text: string; page: string | null }
): Promise<{ messages: FeedbackMessage[] }> {
  const who = await whoIs(userId, fallbackEmail);
  const thread = { id: userId, userId, ...who };
  const previous = await listMessages(userId);
  const now = Date.now();

  await addMessage(thread, { from: "user", text: input.text, kind: input.kind, authorName: null, page: input.page, createdAt: now });

  const lastAuto = [...previous].reverse().find((m) => m.from === "auto");
  const lastTeam = [...previous].reverse().find((m) => m.from === "team");
  const lastAnswerAt = Math.max(lastAuto?.createdAt ?? 0, lastTeam?.createdAt ?? 0);
  if (now - lastAnswerAt > AUTO_REPLY_GAP_MS) {
    await addMessage(thread, {
      from: "auto",
      text: AUTO_REPLIES[input.kind],
      kind: null,
      authorName: "PAR.",
      page: null,
      createdAt: now + 1,
    });
  }

  void sendOwnerEmail(
    `${FEEDBACK_KIND_LABELS[input.kind]} de ${who.displayName} no PAR.`,
    `
      <h1 style="font-size: 20px;">${FEEDBACK_KIND_LABELS[input.kind]}</h1>
      <p style="white-space: pre-wrap; font-size: 15px; line-height: 1.5; background: #f4f2fb; padding: 14px 16px; border-radius: 12px;">${escapeHtml(input.text)}</p>
      <p><strong>De:</strong> ${escapeHtml(who.displayName)} (${escapeHtml(who.email)})<br />
      ${input.page ? `<strong>Tela:</strong> ${escapeHtml(input.page)}<br />` : ""}
      <strong>Quando:</strong> ${new Date(now).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
      <p><a href="${appUrl()}/admin?section=feedback">Responder no PAR.</a> — a pessoa vê a resposta no app.</p>
    `,
    who.email
  );

  return getMyConversation(userId);
}

export async function listThreadsForTeam(): Promise<FeedbackThread[]> {
  return listThreads();
}

export async function getThreadForTeam(threadId: string): Promise<{ thread: FeedbackThread; messages: FeedbackMessage[] }> {
  const thread = await findThread(threadId);
  if (!thread) throw new ThreadNotFoundError();
  const [messages] = await Promise.all([listMessages(threadId), markRead(threadId, "team")]);
  return { thread: { ...thread, unreadForTeam: 0 }, messages };
}

export async function replyAsTeam(
  threadId: string,
  authorName: string,
  text: string
): Promise<{ thread: FeedbackThread; messages: FeedbackMessage[] }> {
  const thread = await findThread(threadId);
  if (!thread) throw new ThreadNotFoundError();
  await addMessage(thread, { from: "team", text, kind: null, authorName, page: null, createdAt: Date.now() });

  void sendEmail(
    thread.email,
    "Você recebeu uma resposta do PAR.",
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 20px;">Oi, ${escapeHtml(thread.displayName.split(" ")[0])}!</h1>
        <p>Respondemos sua mensagem:</p>
        <p style="white-space: pre-wrap; font-size: 15px; line-height: 1.5; background: #f4f2fb; padding: 14px 16px; border-radius: 12px;">${escapeHtml(text)}</p>
        <p><a href="${appUrl()}/dashboard?feedback=1">Abrir a conversa no PAR.</a></p>
      </div>
    `
  );

  return getThreadForTeam(threadId);
}
