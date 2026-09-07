import type { AudioPayload } from "./assistant.types";

export class TelegramNotConfiguredError extends Error {}

const TELEGRAM_API = "https://api.telegram.org";

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramNotConfiguredError();
  return token;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  await fetch(`${TELEGRAM_API}/bot${botToken()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// Telegram voice notes are opus-encoded .oga files -- Gemini accepts
// "audio/ogg" directly, so no local transcoding/transcription step needed.
export async function downloadTelegramVoice(fileId: string): Promise<AudioPayload> {
  const token = botToken();
  const infoRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${fileId}`);
  const info = (await infoRes.json()) as { result?: { file_path?: string } };
  const filePath = info.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile returned no file_path");

  const fileRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { mimeType: "audio/ogg", base64: buffer.toString("base64") };
}
