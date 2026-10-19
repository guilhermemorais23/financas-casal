import { createHmac } from "node:crypto";
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
import { claimInboundMessage } from "./assistant.repository";
import { downloadTelegramVoice } from "./telegram.client";
import { downloadWhatsappAudio } from "./whatsapp.client";
import { logError } from "../../utils/errorLog";
import { safeEqual } from "../../utils/safeEqual";
import { isNonEmptyString } from "../../utils/validation";

export async function createTelegramLinkCodeHandler(req: Request, res: Response) {
  const groupId = await requireGroupId(req.user!.id);
  const code = await createTelegramLinkCode(req.user!.id, groupId);
  res.status(200).json({ code });
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
  update_id?: number;
  message?: {
    chat: { id: number | string };
    text?: string;
    voice?: { file_id: string };
  };
}

// Sem requireAuth aqui -- o Telegram chama direto, sem usuário do Firebase.
// Quem garante que é o Telegram mesmo é o token secreto abaixo, não o nosso
// middleware de login. Sempre responde 200 pro Telegram não ficar tentando
// de novo; as falhas de verdade vão pro log, não pra quem chamou.
export async function telegramWebhookHandler(req: Request, res: Response) {
  // Sem o segredo configurado, recusa tudo: senão qualquer um que achasse a
  // URL mandaria mensagens "do Telegram" em nome de quem já vinculou.
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret || !safeEqual(req.header("x-telegram-bot-api-secret-token") ?? "", expectedSecret)) {
    res.status(401).end();
    return;
  }

  const update = req.body as TelegramUpdate;
  const message = update.message;
  if (!message) {
    res.status(200).end();
    return;
  }
  if (typeof update.update_id === "number" && !(await claimInboundMessage("telegram", String(update.update_id)))) {
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

// Aperto de mão único que a Meta faz quando você cadastra ou troca a URL do
// webhook no painel do app: ela faz um GET com um texto-desafio e espera
// recebê-lo de volta igualzinho, mas SÓ se o hub.verify_token bater com o que
// você digitou nesse mesmo campo do painel -- prova que a URL é sua antes de
// a Meta começar a mandar mensagens de verdade pra ela.
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
          id?: string;
          from: string;
          type: string;
          text?: { body?: string };
          audio?: { id?: string };
        }>;
      };
    }>;
  }>;
}

// Sem requireAuth aqui, pelo mesmo motivo do webhook do Telegram -- a Meta
// chama direto, sem usuário do Firebase; quem garante a origem é o aperto de
// mão acima mais saber esta URL exata. Sempre responde 200 pra Meta não ficar
// tentando de novo; as falhas de verdade vão pro log, não pra Meta.
export async function whatsappWebhookHandler(req: Request, res: Response) {
  // A Meta assina cada POST com o App Secret (X-Hub-Signature-256). Sem
  // conferir isso, quem achasse a URL lançaria gastos na conta de qualquer
  // número vinculado. Sem o segredo configurado, ignora tudo.
  if (!isValidMetaSignature(req)) {
    logError("whatsapp-webhook", new Error("assinatura da Meta ausente ou inválida"), { path: req.path, method: req.method });
    res.status(401).end();
    return;
  }
  const message = (req.body as WhatsappWebhookPayload).entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    res.status(200).end();
    return;
  }
  if (message.id && !(await claimInboundMessage("whatsapp", message.id))) {
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

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256(App Secret, corpo cru).
export function isValidMetaSignature(req: Request): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  const header = req.header("x-hub-signature-256") ?? "";
  if (!appSecret || !raw || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  return safeEqual(header, expected);
}
