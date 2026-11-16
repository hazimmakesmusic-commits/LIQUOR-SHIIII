import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { parseItems, parsePegs, wordsToDigits } from "./slang.js";
import { CATEGORIES, type CatalogEntry, type Category, type Understanding } from "./types.js";

export const MODEL = process.env.LLM_MODEL || "claude-opus-5-5";
export const llm = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
// Server-side refusal fallback: if the model declines, the API reroutes to a fallback model in the same call.
export const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

const Schema = z.object({
  intent: z.enum(["stock_check", "budget_plan", "trivia", "reserve", "other"]),
  items: z.array(
    z.object({
      brand: z.string().describe("Exact brand name from the catalog, or the customer's words if not in the catalog"),
      category: z.enum(CATEGORIES).nullable(),
      size_ml: z.number().int().nullable(),
      qty: z.number().int(),
    }),
  ),
  budget_inr: z.number().int().nullable(),
  headcount: z.number().int().nullable(),
  preferences: z.array(z.enum(CATEGORIES)),
  level: z.enum(["light", "normal", "long_night"]).nullable(),
  drinks_per_person: z.number().nullable(),
  question: z.string().nullable(),
});

function systemPrompt(catalog: CatalogEntry[]) {
  const lines = catalog.map((c) => `${c.brand} | ${c.category} | ${c.aliases.join(", ")}`).join("\n");
  return `You read WhatsApp messages sent to a Delhi liquor store and extract what the customer wants. You never answer them; you only fill the schema.

Customers write in Hinglish, Hindi or English with heavy slang and typos.
Sizes: quarter/pauwa/nip = 180ml, half/adha/pint = 375ml, full/botal/khamba = 750ml. Beer comes in 650ml.
Pegs: small = 30ml, large = 60ml, patiala = 90ml. One "drink" = one 60ml large peg.
If they give drinks in pegs, convert to drinks_per_person (e.g. "4 small peg each" = 2).
Quantities: ek=1, do=2, teen=3, char=4. "do" can also mean "give" ("de do", "kar do"), so only treat it as 2 next to a size or brand.
size_ml is null if they didn't say a size. qty defaults to 1.

Intents:
- stock_check: asking if items are available or their price ("OM half hai?", "2 full BP kitne ka").
- budget_plan: party planning with a budget and/or headcount ("5000 me 6 log", "10 dost, 3000 budget, beer whisky"). preferences = categories they want; level = light/normal/long_night if they hint at it.
- trivia: questions about drinks or brands (history, taste, how to drink, differences). Put their question in "question" and any brands mentioned in items.
- reserve: wants to hold/book/keep items for pickup ("rakh do", "hold kar do", "book kar do"). If they say it without naming items, items = [].
- other: greetings, thanks, anything else.

Store catalog (brand | category | slang aliases). Map slang to the exact brand name here:
${lines}

If a brand is not in the catalog, keep the customer's brand name as written and still guess its category.`;
}

/** Message -> structured intent. Uses Claude when a key is configured, rule-based parsing otherwise or on failure. */
export async function understand(text: string, catalog: CatalogEntry[], context = ""): Promise<Understanding> {
  if (!llm) return ruleBased(text, catalog);
  try {
    const res = await llm.beta.messages.parse({
      model: MODEL,
      max_tokens: 4000,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
      system: [{ type: "text", text: systemPrompt(catalog), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: context ? `${context}\n\nCustomer message: ${text}` : text }],
    });
    const o = res.parsed_output;
    if (res.stop_reason === "refusal" || !o) return ruleBased(text, catalog);
    return {
      intent: o.intent,
      items: o.items.map((i) => ({ brand: i.brand, category: i.category, sizeMl: i.size_ml, qty: Math.max(1, i.qty) })),
      budgetInr: o.budget_inr,
      headcount: o.headcount,
      preferences: o.preferences,
      level: o.level,
      drinksPerPerson: o.drinks_per_person,
      question: o.question,
    };
  } catch (err) {
    console.error("Claude understand failed, using rule-based parser:", err instanceof Error ? err.message : err);
    return ruleBased(text, catalog);
  }
}

/** Offline fallback: regexes + slang parser. Good enough for clear messages; Claude handles the messy ones. */
export function ruleBased(raw: string, catalog: CatalogEntry[]): Understanding {
  const text = wordsToDigits(raw); // already lowercased and tokenized
  const t = text;
  const items = parseItems(text, catalog).map((i) => ({ ...i, category: (catalog.find((c) => c.brand === i.brand)?.category as Category) ?? null }));
  const budget = t.match(/(?:rs|inr|budget|rupees?|rupaye)\s*(\d{3,6})|(\d{3,6})\s*(?:rs|rupees?|rupaye|(?:ka|ke|ki)\s*budget|budget|me|mein|tak)\b/) ?? raw.match(/₹\s*(\d{3,6})/);
  const head = t.match(/(\d{1,3})\s*(?:log|logo|logon|people|persons?|bande|banda|jan|friends|dost|guests?|members?)\b/);
  const preferences = CATEGORIES.filter((c) => new RegExp(`\\b${c === "whisky" ? "whiske?y" : c}s?\\b`).test(t));
  const level = /\b(light|halka|halki|thoda)\b/.test(t) ? "light" : /\b(long night|lambi|raat bhar|all night|full night)\b/.test(t) ? "long_night" : null;

  const intent: Understanding["intent"] =
    /\b(reserve|hold|rakh|rakhna|book|booking|keep)\b/.test(t) ? "reserve"
    : head || (budget && !items.length) ? "budget_plan"
    : /\b(kya hai|kaisi|kaisa|kaise|history|story|fact|kahan ki|kahan se|difference|farak|fark|why|kyun|taste|origin|batao)\b/.test(t) ? "trivia"
    : items.length ? "stock_check"
    : "other";

  return {
    intent,
    items,
    budgetInr: budget ? Number(budget[1] ?? budget[2]) : null,
    headcount: head ? Number(head[1]) : null,
    preferences,
    level,
    drinksPerPerson: parsePegs(text),
    question: intent === "trivia" ? raw : null,
  };
}
