// WhatsApp Cloud API (Meta): receive messages via webhook, reply via the Graph API.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { handleMessage } from "./bot.js";
import { MAX_VOICE_SECONDS, transcribe, VoiceError } from "./voice.js";

const GRAPH = `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || "v23.0"}`;
const MAX_TEXT = 4096; // WhatsApp text body limit

/** Meta signs every webhook body with the app secret; reject anything that doesn't match. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type Incoming = { phoneNumberId: string; from: string; id: string } & (
  | { type: "text"; text: string }
  | { type: "audio"; mediaId: string }
  | { type: "other" }
);

/** Pulls customer messages out of a webhook payload; delivery/read status updates are ignored. */
export function extractMessages(body: any): Incoming[] {
  const out: Incoming[] = [];
  for (const entry of body?.entry ?? [])
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      for (const m of value?.messages ?? []) {
        if (!phoneNumberId || !m?.from || !m?.id) continue;
        const base = { phoneNumberId: String(phoneNumberId), from: String(m.from), id: String(m.id) };
        if (m.type === "text" && typeof m.text?.body === "string") out.push({ ...base, type: "text", text: m.text.body });
        else if (m.type === "audio" && m.audio?.id) out.push({ ...base, type: "audio", mediaId: String(m.audio.id) });
        else out.push({ ...base, type: "other" });
      }
    }
  return out;
}

async function graph(path: string, init: RequestInit = {}) {
  const res = await fetch(path.startsWith("http") ? path : `${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, ...init.headers },
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

export async function sendText(phoneNumberId: string, to: string, body: string) {
  await graph(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, MAX_TEXT), preview_url: false } }),
  });
}

/** Voice note bytes: first ask Graph for a short-lived URL, then download it (both need the token). */
async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const meta = (await (await graph(mediaId)).json()) as { url: string; mime_type: string };
  const bytes = new Uint8Array(await (await graph(meta.url)).arrayBuffer());
  return { bytes, mimeType: meta.mime_type };
}

// Meta retries a webhook if it doesn't get a fast 200; we answer at once, but skip repeats anyway.
// shortcut: in-memory, so a restart forgets recent ids; move to a DB table if duplicates show up.
const seen = new Set<string>();
function firstTime(id: string) {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > 5000) seen.delete(seen.values().next().value!);
  return true;
}

/** One customer message in, one WhatsApp reply out. Errors become a polite reply, never silence. */
export async function processMessage(msg: Incoming) {
  if (!firstTime(msg.id)) return;
  const store = await db.store.findFirst({ where: { waPhoneNumberId: msg.phoneNumberId } });
  if (!store) return console.warn(`WhatsApp message for unlinked number ${msg.phoneNumberId}; run npm run link-whatsapp`);

  let reply: string;
  try {
    if (msg.type === "text") reply = await handleMessage(store.id, msg.from, msg.text.trim().slice(0, 1000) || "hi");
    else if (msg.type === "audio") {
      const { bytes, mimeType } = await downloadMedia(msg.mediaId);
      const transcript = await transcribe(bytes, mimeType);
      reply = transcript
        ? await handleMessage(store.id, msg.from, transcript.slice(0, 1000))
        : "Awaaz saaf nahi aayi 🙏 Dobara bolke bhejiye ya type kar dijiye.";
    } else reply = "Abhi sirf text ya voice note samajh pata hoon. 🙏 Jaise: \"OM half hai?\"";
  } catch (err) {
    console.error(err);
    reply =
      err instanceof VoiceError
        ? `Voice note samajh nahi paya. ${MAX_VOICE_SECONDS} second se chhota bhejiye ya type kar dijiye. 🙏`
        : "Kuch gadbad ho gayi, thodi der me dobara try karein. 🙏";
  }
  await sendText(msg.phoneNumberId, msg.from, reply);
}
