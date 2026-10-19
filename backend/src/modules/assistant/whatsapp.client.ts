import type { AudioPayload } from "./assistant.types";

export class WhatsappNotConfiguredError extends Error {}

// A Meta desativa versões antigas da Graph API com o tempo -- suba este
// número à mão se a Meta mandar e-mail avisando o prazo da versão fixada aqui.
const GRAPH_API_VERSION = "v21.0";
const GRAPH_API = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function phoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new WhatsappNotConfiguredError();
  return id;
}

function accessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new WhatsappNotConfiguredError();
  return token;
}

export async function sendWhatsappMessage(to: string, text: string): Promise<void> {
  await fetch(`${GRAPH_API}/${phoneNumberId()}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
}

// Áudio do WhatsApp chega em .ogg (opus), da mesma família que o Gemini já
// aceita no Telegram -- não precisa converter. Diferente do getFile do
// Telegram (uma chamada, devolve um caminho que se baixa sem login), a mídia
// da Graph API precisa de duas: buscar a url de download (assinada e de
// vida curta) pelo id da mídia, e depois baixar essa url com o mesmo token.
export async function downloadWhatsappAudio(mediaId: string): Promise<AudioPayload> {
  const token = accessToken();
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("WhatsApp media lookup returned no url");

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { mimeType: meta.mime_type ?? "audio/ogg", base64: buffer.toString("base64") };
}
