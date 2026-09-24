import type { Request, Response } from "express";
import { db } from "../../db/firestore";
import { escapeHtml, sendOwnerEmail } from "../../email/mailer";
import { findUserById } from "../users/users.repository";

export const FEEDBACK_KINDS = { idea: "💡 Ideia", problem: "🐞 Problema", praise: "💜 Elogio" } as const;
type FeedbackKind = keyof typeof FEEDBACK_KINDS;

const MAX_MESSAGE_LENGTH = 2000;

function isFeedbackKind(value: unknown): value is FeedbackKind {
  return typeof value === "string" && value in FEEDBACK_KINDS;
}

// "Enviar feedback" from the app's Mais menu: stored in Firestore (so
// nothing is lost if email isn't configured) and emailed to the owner, with
// Reply-To set to the person who sent it so answering is one click.
export async function createFeedbackHandler(req: Request, res: Response) {
  const { kind, message, page } = req.body ?? {};
  const text = typeof message === "string" ? message.trim() : "";
  if (text.length < 3) {
    res.status(400).json({ error: "Escreva pelo menos algumas palavras." });
    return;
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Máximo de ${MAX_MESSAGE_LENGTH} caracteres.` });
    return;
  }
  const safeKind: FeedbackKind = isFeedbackKind(kind) ? kind : "idea";
  const safePage = typeof page === "string" ? page.slice(0, 200) : null;

  const user = await findUserById(req.user!.id);
  const email = user?.email ?? req.user!.email;
  const displayName = user?.displayName ?? email;

  await db.collection("feedback").add({
    userId: req.user!.id,
    email,
    displayName,
    kind: safeKind,
    message: text,
    page: safePage,
    createdAt: new Date(),
  });

  void sendOwnerEmail(
    `${FEEDBACK_KINDS[safeKind]} de ${displayName} no PAR.`,
    `
      <h1 style="font-size: 20px;">${FEEDBACK_KINDS[safeKind]}</h1>
      <p style="white-space: pre-wrap; font-size: 15px; line-height: 1.5; background: #f4f2fb; padding: 14px 16px; border-radius: 12px;">${escapeHtml(text)}</p>
      <p><strong>De:</strong> ${escapeHtml(displayName)} (${escapeHtml(email)})<br />
      ${safePage ? `<strong>Tela:</strong> ${escapeHtml(safePage)}<br />` : ""}
      <strong>Quando:</strong> ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
      <p style="font-size: 13px; color: #666;">Responder este email responde direto pra pessoa.</p>
    `,
    email
  );

  res.status(201).json({ ok: true });
}
