import { test } from "node:test";
import assert from "node:assert/strict";
import { transcribe, VoiceError } from "../src/voice.js";

test("sends Sarvam the audio as Roman-script (translit) request and returns the transcript", async (t) => {
  process.env.SARVAM_API_KEY = "test-key";
  let sent: { url: string; init: RequestInit } | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    sent = { url, init };
    return new Response(JSON.stringify({ transcript: " om half hai kya " }), { status: 200 });
  });
  assert.equal(await transcribe(new Uint8Array([1, 2, 3]), "audio/webm;codecs=opus"), "om half hai kya");
  assert.equal(sent!.url, "https://api.sarvam.ai/speech-to-text");
  assert.equal((sent!.init.headers as Record<string, string>)["api-subscription-key"], "test-key");
  const form = sent!.init.body as FormData;
  assert.equal(form.get("mode"), "translit");
  assert.equal(form.get("model"), "saaras:v3");
  const file = form.get("file") as File;
  assert.equal(file.name, "voice.webm");
  assert.equal(file.type, "audio/webm");
});

test("API errors and a missing key raise VoiceError", async (t) => {
  process.env.SARVAM_API_KEY = "test-key";
  t.mock.method(globalThis, "fetch", async () => new Response("too long", { status: 400 }));
  await assert.rejects(transcribe(new Uint8Array([1]), "audio/ogg"), VoiceError);
  delete process.env.SARVAM_API_KEY;
  await assert.rejects(transcribe(new Uint8Array([1]), "audio/ogg"), /SARVAM_API_KEY/);
});
