import type { AudioPayload } from "./assistant.types";

export class WhatsappNotConfiguredError extends Error {}

// Meta deprecates old Graph API versions over time -- bump this by hand if
// Meta emails about a deprecation deadline for whatever version is pinned.
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

// WhatsApp voice notes arrive as opus-encoded .ogg, same family Gemini
// already accepts for Telegram voice notes -- no transcoding needed. Unlike
// Telegram's getFile (one call, returns a path you fetch unauthenticated),
// the Graph API's media endpoint needs two calls: look up the (short-lived,
// signed) download url by media id, then fetch that url with the same
// bearer token.
export async function downloadWhatsappAudio(mediaId: string): Promise<AudioPayload> {
  const token = accessToken();
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) throw new Error("WhatsApp media lookup returned no url");

  const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { mimeType: meta.mime_type ?? "audio/ogg", base64: buffer.toString("base64") };
}
