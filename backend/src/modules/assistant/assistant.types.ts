// Shared across every messaging channel (Telegram, WhatsApp) that can send
// the assistant a voice note -- same {mimeType, base64} shape Gemini's
// inlineData part expects, regardless of which platform it came from.
export interface AudioPayload {
  mimeType: string;
  base64: string;
}
