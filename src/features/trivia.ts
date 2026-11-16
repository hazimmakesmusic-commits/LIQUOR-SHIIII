import { db } from "../db.js";
import { sizesLine } from "../format.js";
import { FALLBACK, llm, MODEL } from "../understand.js";
import type { ItemRequest, PriceMode, StockRow } from "../types.js";

const SYSTEM = `You are the friendly WhatsApp assistant of a Delhi liquor store. Answer the customer's drinks question in short, warm Hinglish (Roman script), max 70 words, no markdown headings.
- General drinks knowledge (styles, how whisky is made, what a peg is, mixers, food pairing) you may answer from your own knowledge.
- Facts about a SPECIFIC BRAND (origin, history, owner, awards, taste) must come ONLY from the BRAND FACTS given. If the facts don't cover what was asked, say "iske baare me pakki jaankari nahi hai" instead of guessing.
- Never mention prices or stock; the store adds that separately.
- Never encourage heavy drinking or drinking and driving.`;

/** Brand facts only from the brand_info table; general questions answered by Claude; ends with what's in stock. */
export async function trivia(storeId: string, mode: PriceMode, question: string, items: ItemRequest[], stock: StockRow[]) {
  const brands = [...new Set(items.map((i) => i.brand))];
  const facts = await db.brandInfo.findMany({ where: { storeId, brand: { in: brands } } });
  const factText = facts.map((f) => `${f.brand}: origin ${f.origin}. Taste: ${f.tasteNotes}. How to drink: ${f.howToDrink}. Fact: ${f.funFact}.`).join("\n");

  let answer = facts.map((f) => `*${f.brand}* – ${f.origin}. Taste: ${f.tasteNotes}. Kaise piyein: ${f.howToDrink}. Fun fact: ${f.funFact}.`).join("\n");
  if (llm) {
    try {
      const res = await llm.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        ...FALLBACK,
        output_config: { effort: "low" },
        system: SYSTEM,
        messages: [{ role: "user", content: `BRAND FACTS:\n${factText || "(none)"}\n\nCUSTOMER QUESTION: ${question}` }],
      });
      if (res.stop_reason !== "refusal") answer = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim() || answer;
    } catch (err) {
      console.error("Claude trivia failed, using brand_info template:", err instanceof Error ? err.message : err);
    }
  }
  if (!answer) answer = "Is sawaal ka jawab abhi nahi de paunga, counter pe pooch lijiye. 🙏";

  const avail = brands.map((b) => {
    const line = sizesLine(mode, stock.filter((r) => r.brand === b));
    return line ? `📦 ${b}: ${line} – stock me hai` : `📦 ${b}: abhi stock me nahi`;
  });
  return [answer, ...avail].join("\n");
}
