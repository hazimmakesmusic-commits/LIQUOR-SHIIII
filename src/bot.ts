import { db } from "./db.js";
import { AGE_NO, AGE_PROMPT, AGE_YES, DELIVERY, LEGAL_AGE, storeStatus } from "./guardrails.js";
import { getCatalog, getStock } from "./inventory.js";
import { understand } from "./understand.js";
import { budgetReply, DRINKS_PER_PERSON, planBudget } from "./features/budget.js";
import { reserve } from "./features/reserve.js";
import { stockCheck } from "./features/stock.js";
import { trivia } from "./features/trivia.js";
import type { Category, ItemRequest, PriceMode } from "./types.js";

const HELP =
  `Main in cheezon me madad kar sakta hoon:\n` +
  `• Stock/price: "OM half hai?", "2 full BP kitne ki?"\n` +
  `• Party plan: "6 log, 4000 budget, whisky + beer"\n` +
  `• Brand info: "Jameson kaisi hoti hai?"\n` +
  `• Pickup hold (2 ghante): "2 KF strong hold kar do"\n` +
  `Delivery nahi hoti, sirf store pickup. 🙏`;

/**
 * Channel-agnostic entry point: one customer message in, one reply out.
 * The /test page calls this today; the Phase 2 WhatsApp webhook will call the same function.
 */
export async function handleMessage(storeId: string, phone: string, text: string, now = new Date()): Promise<string> {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) throw new Error(`Unknown store ${storeId}`);
  const mode = store.priceMode as PriceMode;

  const customer = await db.customer.upsert({
    where: { storeId_phone: { storeId, phone } },
    create: { storeId, phone },
    update: {},
  });

  // Age gate: nothing else happens until the customer confirms they're of legal age.
  if (!customer.ageConfirmed) {
    if (AGE_YES.test(text)) {
      await db.customer.update({ where: { id: customer.id }, data: { ageConfirmed: true } });
      return `Shukriya! 🙌 ${store.name} me swagat hai.\n\n${HELP}`;
    }
    if (AGE_NO.test(text)) return `Maaf kijiye, ${LEGAL_AGE} saal se kam age ke customers ko hum service nahi de sakte. 🙏`;
    return AGE_PROMPT;
  }

  if (DELIVERY.test(text)) return `Sorry, hum delivery nahi karte. 🙏 Sirf store se pickup hota hai. Chahein to items 2 ghante ke liye hold kar sakta hoon.`;

  const [catalog, stock, status] = await Promise.all([getCatalog(storeId), getStock(storeId, now), storeStatus(store, now)]);
  const lastItems: ItemRequest[] = JSON.parse(customer.lastItems);
  const context = lastItems.length ? `Previously enquired: ${lastItems.map((i) => `${i.qty} x ${i.brand} ${i.sizeMl}ml`).join(", ")}` : "";
  const u = await understand(text, catalog, context);

  let reply: string;
  switch (u.intent) {
    case "stock_check": {
      if (!u.items.length) {
        reply = `Kaunsa brand aur size dekhun? Jaise "OM half" ya "2 full BP".`;
        break;
      }
      const res = await stockCheck(storeId, mode, u.items, stock);
      await db.customer.update({ where: { id: customer.id }, data: { lastItems: JSON.stringify(res.remember) } });
      reply = res.reply;
      break;
    }
    case "budget_plan": {
      if (!u.budgetInr || !u.headcount) {
        reply = `Party plan kar dete hain! 🎉 Bas batayiye: kitne log hain aur total budget kitna hai? (Aur pasand: whisky/rum/vodka/beer/gin/wine)`;
        break;
      }
      const categories: Category[] = u.preferences.length ? u.preferences : ["whisky", "beer"];
      const input = {
        budgetInr: u.budgetInr,
        headcount: u.headcount,
        categories,
        drinksPerPerson: u.drinksPerPerson ?? DRINKS_PER_PERSON[u.level ?? "normal"],
      };
      reply = budgetReply(planBudget(input, stock.filter((r) => r.available > 0)), input, mode);
      break;
    }
    case "trivia":
      reply = await trivia(storeId, mode, u.question ?? text, u.items, stock);
      break;
    case "reserve":
      reply = await reserve(store, phone, u.items.length ? u.items : lastItems, status, now);
      return reply; // reserve already explains closed/dry-day itself
    default:
      reply = HELP;
  }
  return status.note ? `${status.note}\n\n${reply}` : reply;
}
