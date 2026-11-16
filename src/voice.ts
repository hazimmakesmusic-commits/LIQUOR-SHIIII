// Voice notes -> text via Sarvam AI (built for Hindi/Hinglish). The text then goes through handleMessage like any typed message.
export const MAX_VOICE_SECONDS = 30; // Sarvam's sync REST limit

const EXT: Record<string, string> = { "audio/ogg": "ogg", "audio/webm": "webm", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/aac": "aac" };

export class VoiceError extends Error {}

/** Audio bytes -> Roman-script Hinglish ("om half hai kya"), the form the slang parser and Claude read. */
export async function transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new VoiceError("SARVAM_API_KEY is not set");
  const type = mimeType.split(";")[0].trim().toLowerCase();
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type }), `voice.${EXT[type] ?? "ogg"}`);
  // saaras:v3 because Sarvam documents `mode` for v3; translit = Latin script, not Devanagari.
  form.append("model", "saaras:v3");
  form.append("mode", "translit");
  form.append("language_code", "unknown");

  const res = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: { "api-subscription-key": key },
    body: form,
  });
  if (!res.ok) throw new VoiceError(`Sarvam HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { transcript?: string };
  return (json.transcript ?? "").trim();
}
