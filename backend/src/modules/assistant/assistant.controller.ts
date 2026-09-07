import type { Request, Response } from "express";
import { requireGroupId } from "../groups/groups.service";
import {
  answerAssistantMessage,
  AssistantNotConfiguredError,
  createTelegramLinkCode,
  generateGreeting,
  handleTelegramMessage,
  handleWhatsappMessage,
} from "./assistant.service";
import { downloadTelegramVoice } from "./telegram.client";
import { downloadWhatsappAudio } from "./whatsapp.client";
import { logError } from "../../utils/errorLog";

export async function createTelegramLinkCodeHandler(req: Request, res: Response) {
  const groupId = await requireGroupId(req.user!.id);
  const code = await createTelegramLinkCode(req.user!.id, groupId);
  res.status(200).json({ code });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function chatHandler(req: Request, res: Response) {
  const { message } = req.body ?? {};
  if (!isNonEmptyString(message)) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  try {
    const reply = await answerAssistantMessage(req.user!.id, message.trim());
    res.status(200).json({ reply });
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      res.status(503).json({ error: "assistente ainda não configurado" });
      return;
    }
    throw err;
  }
}

export async function greetingHandler(req: Request, res: Response) {
  try {
    const text = await generateGreeting(req.user!.id);
    res.status(200).json({ text });
  } catch (err) {
    if (err instanceof AssistantNotConfiguredError) {
      res.status(503).json({ error: "assistente ainda não configurado" });
      return;
    }
    throw err;
  }
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
    logError("telegram-webhook", err, { path: req.path, method: req.method });
  }

  res.status(200).end();
}

// One-time handshake Meta does when you register/change the webhook URL in
// the app dashboard: it GETs this with a challenge string and expects it
// echoed back verbatim, but ONLY if hub.verify_token matches what you typed
// into that same dashboard field -- proves the URL is actually yours before
// Meta starts POSTing real messages to it.
export function whatsappWebhookVerifyHandler(req: Request, res: Response) {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (verifyToken && mode === "subscribe" && token === verifyToken) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
}

interface WhatsappWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from: string;
          type: string;
          text?: { body?: string };
          audio?: { id?: string };
        }>;
      };
    }>;
  }>;
}

// No requireAuth here, same reasoning as the Telegram webhook -- Meta calls
// this directly with no Firebase user; authenticity is the verify handshake
// above plus knowledge of this exact URL. Always answers 200 so Meta
// doesn't keep retrying; real failures are logged, not surfaced to Meta.
export async function whatsappWebhookHandler(req: Request, res: Response) {
  const message = (req.body as WhatsappWebhookPayload).entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    res.status(200).end();
    return;
  }
  const waId = message.from;

  try {
    if (message.type === "audio" && message.audio?.id) {
      const audio = await downloadWhatsappAudio(message.audio.id);
      await handleWhatsappMessage(waId, undefined, audio);
    } else if (message.type === "text" && message.text?.body) {
      await handleWhatsappMessage(waId, message.text.body, undefined);
    }
  } catch (err) {
    console.error("[whatsapp webhook]", err);
    logError("whatsapp-webhook", err, { path: req.path, method: req.method });
  }

  res.status(200).end();
}
