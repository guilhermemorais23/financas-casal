// Compartilhado por todos os canais de mensagem (Telegram, WhatsApp) que
// podem mandar áudio pro assistente -- o mesmo formato {mimeType, base64} que
// a parte inlineData do Gemini espera, venha de qual plataforma vier.
export interface AudioPayload {
  mimeType: string;
  base64: string;
}
