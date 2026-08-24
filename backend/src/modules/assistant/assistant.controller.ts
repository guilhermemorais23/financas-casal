import type { Request, Response } from "express";
import { requireGroupId } from "../groups/groups.service";
import { createTelegramLinkCode, handleTelegramMessage } from "./assistant.service";
import { downloadTelegramVoice } from "./telegram.client";

export async function createTelegramLinkCodeHandler(req: Request, res: Response) {
  const groupId = await requireGroupId(req.user!.id);
  const code = await createTelegramLinkCode(req.user!.id, groupId);
  res.status(200).json({ code });
}

interface TelegramUpdate {
  message?: {
    chat: { id: number | string };
    text?: string;
    voice?: { file_id: string };
  };
}

// No requireAuth here -- Telegram calls this directly, with no Firebase
// user. Authenticity comes from the secret token below, not from our own
// auth middleware. Always answers 200 so Telegram doesn't keep retrying;
// real failures are logged, not surfaced to the caller.
export async function telegramWebhookHandler(req: Request, res: Response) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret && req.header("x-telegram-bot-api-secret-token") !== expectedSecret) {
    res.status(401).end();
    return;
  }

  const message = (req.body as TelegramUpdate).message;
  if (!message) {
    res.status(200).end();
    return;
  }
  const chatId = String(message.chat.id);

  try {
    if (message.voice?.file_id) {
      const audio = await downloadTelegramVoice(message.voice.file_id);
      await handleTelegramMessage(chatId, undefined, audio);
    } else if (typeof message.text === "string") {
      await handleTelegramMessage(chatId, message.text, undefined);
    }
  } catch (err) {
    console.error("[telegram webhook]", err);
  }

  res.status(200).end();
}
