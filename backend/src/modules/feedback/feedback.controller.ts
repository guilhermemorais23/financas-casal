import type { Request, Response } from "express";
import { NotAdminError, requireAdminEmail } from "../admin/admin.service";
import { findUserById } from "../users/users.repository";
import type { FeedbackKind } from "./feedback.repository";
import {
  MAX_MESSAGE_LENGTH,
  ThreadNotFoundError,
  getMyConversation,
  getMyUnread,
  getThreadForTeam,
  listThreadsForTeam,
  replyAsTeam,
  sendUserMessage,
} from "./feedback.service";

function isFeedbackKind(value: unknown): value is FeedbackKind {
  return value === "idea" || value === "problem" || value === "praise";
}

function readText(value: unknown, res: Response): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 2) {
    res.status(400).json({ error: "Escreva sua mensagem." });
    return null;
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Máximo de ${MAX_MESSAGE_LENGTH} caracteres.` });
    return null;
  }
  return text;
}

function isAdmin(req: Request, res: Response): boolean {
  try {
    requireAdminEmail(req.user!.email);
    return true;
  } catch (err) {
    if (err instanceof NotAdminError) {
      res.status(403).json({ error: "not an admin" });
      return false;
    }
    throw err;
  }
}

export async function getMyConversationHandler(req: Request, res: Response) {
  res.json(await getMyConversation(req.user!.id));
}

export async function getMyUnreadHandler(req: Request, res: Response) {
  res.json({ unread: await getMyUnread(req.user!.id) });
}

// "Fale com a gente": the person's message goes into their conversation,
// an automatic thank-you answers right away, and the owner gets an email.
export async function createFeedbackHandler(req: Request, res: Response) {
  const { kind, message, page } = req.body ?? {};
  const text = readText(message, res);
  if (text === null) return;
  const conversation = await sendUserMessage(req.user!.id, req.user!.email, {
    kind: isFeedbackKind(kind) ? kind : "idea",
    text,
    page: typeof page === "string" ? page.slice(0, 200) : null,
  });
  res.status(201).json(conversation);
}

export async function listThreadsHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  res.json({ threads: await listThreadsForTeam() });
}

export async function getThreadHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  try {
    res.json(await getThreadForTeam(String(req.params.threadId)));
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }
    throw err;
  }
}

export async function replyHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  const text = readText(req.body?.message, res);
  if (text === null) return;
  try {
    const me = await findUserById(req.user!.id);
    const authorName = me?.displayName?.split(" ")[0] || "PAR.";
    res.status(201).json(await replyAsTeam(String(req.params.threadId), authorName, text));
  } catch (err) {
    if (err instanceof ThreadNotFoundError) {
      res.status(404).json({ error: "Conversa não encontrada." });
      return;
    }
    throw err;
  }
}
