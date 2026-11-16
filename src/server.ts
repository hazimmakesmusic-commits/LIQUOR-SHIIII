import express from "express";
import { db } from "./db.js";
import { handleMessage } from "./bot.js";
import { llm, MODEL } from "./understand.js";

const PRICE_MODES = ["full", "totals_only", "none"];
const app = express();
app.use(express.json());
app.use(express.static("public"));

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

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Liquor bot on http://localhost:${port}/test`);
  console.log(llm ? `Language understanding: Claude (${MODEL})` : "No ANTHROPIC_API_KEY: using the offline rule-based parser");
});
