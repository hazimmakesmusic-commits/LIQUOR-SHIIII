import express from "express";
import { db } from "./db.js";
import { handleMessage } from "./bot.js";
import { llm, MODEL } from "./understand.js";
import { MAX_VOICE_SECONDS, transcribe, VoiceError } from "./voice.js";
import { extractMessages, processMessage, verifySignature } from "./whatsapp.js";

const PRICE_MODES = ["full", "totals_only", "none"];
const app = express();

// --- WhatsApp webhook (Meta). Registered before express.json(): the signature is checked on the raw bytes.
app.get("/webhook/whatsapp", (req, res) => {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (req.query["hub.mode"] === "subscribe" && token && req.query["hub.verify_token"] === token) res.send(String(req.query["hub.challenge"]));
  else res.sendStatus(403);
});

app.post("/webhook/whatsapp", express.raw({ type: "application/json", limit: "1mb" }), (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !Buffer.isBuffer(req.body) || !verifySignature(req.body, req.header("x-hub-signature-256"), secret)) return res.sendStatus(401);
  res.sendStatus(200); // answer Meta at once; replies go out separately
  let body: unknown;
  try {
    body = JSON.parse(req.body.toString("utf8"));
  } catch {
    return;
  }
  for (const msg of extractMessages(body)) processMessage(msg).catch((err) => console.error("WhatsApp reply failed:", err));
});

// --- Test page + store settings. Once online, ADMIN_PASSWORD locks them (browser asks for it; any username).
app.use(["/test", "/api"], (req, res, next) => {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return next();
  const [, b64 = ""] = (req.headers.authorization ?? "").split(" ");
  if (Buffer.from(b64, "base64").toString().split(":").slice(1).join(":") === password) return next();
  res.set("WWW-Authenticate", 'Basic realm="Liquor bot"').status(401).send("Password required");
});
app.use(express.json());

app.get("/test", (_req, res) => res.sendFile("test.html", { root: "public" }));

app.get("/api/stores", async (_req, res) => {
  res.json(await db.store.findMany({ select: { id: true, name: true, priceMode: true }, orderBy: { name: "asc" } }));
});

// Instant kill-switch for prices if WhatsApp warns a store.
app.patch("/api/stores/:id", async (req, res) => {
  const { priceMode } = req.body ?? {};
  if (!PRICE_MODES.includes(priceMode)) return res.status(400).json({ error: `priceMode must be one of ${PRICE_MODES.join(", ")}` });
  res.json(await db.store.update({ where: { id: req.params.id }, data: { priceMode }, select: { id: true, priceMode: true } }));
});

app.post("/api/chat", async (req, res) => {
  const { storeId, phone, text } = req.body ?? {};
  if (typeof storeId !== "string" || typeof phone !== "string" || typeof text !== "string" || !text.trim() || text.length > 1000)
    return res.status(400).json({ error: "storeId, phone and text (1-1000 chars) are required" });
  try {
    res.json({ reply: await handleMessage(storeId, phone, text.trim()) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ reply: "Kuch gadbad ho gayi, thodi der me dobara try karein. 🙏" });
  }
});

// Voice note: raw audio body, ?storeId=&phone=. Transcribed, then handled exactly like a typed message.
app.post("/api/voice", express.raw({ type: "audio/*", limit: "10mb" }), async (req, res) => {
  const { storeId, phone } = req.query;
  if (typeof storeId !== "string" || typeof phone !== "string" || !Buffer.isBuffer(req.body) || !req.body.length)
    return res.status(400).json({ error: "storeId and phone query params and an audio/* body are required" });
  try {
    const transcript = await transcribe(req.body, req.headers["content-type"] ?? "audio/ogg");
    if (!transcript) return res.json({ transcript, reply: "Awaaz saaf nahi aayi 🙏 Dobara bolke bhejiye ya type kar dijiye." });
    res.json({ transcript, reply: await handleMessage(storeId, phone, transcript.slice(0, 1000)) });
  } catch (err) {
    console.error(err);
    const voiceOff = err instanceof VoiceError && !process.env.SARVAM_API_KEY;
    res.status(voiceOff ? 503 : 502).json({
      reply: voiceOff
        ? "Voice message abhi on nahi hai, type karke bhejiye. 🙏"
        : `Voice note samajh nahi paya. ${MAX_VOICE_SECONDS} second se chhota bhejiye ya type kar dijiye. 🙏`,
    });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Liquor bot on http://localhost:${port}/test`);
  console.log(llm ? `Language understanding: Claude (${MODEL})` : "No ANTHROPIC_API_KEY: using the offline rule-based parser");
  console.log(process.env.SARVAM_API_KEY ? "Voice notes: on (Sarvam AI)" : "No SARVAM_API_KEY: voice notes are off");
  const wa = ["WHATSAPP_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"].filter((k) => !process.env[k]);
  console.log(wa.length ? `WhatsApp: off (missing ${wa.join(", ")})` : "WhatsApp: on (webhook at /webhook/whatsapp)");
  if (!wa.length && !process.env.ADMIN_PASSWORD) console.warn("⚠️  Set ADMIN_PASSWORD before going online, or anyone can open /test and change prices.");
});
