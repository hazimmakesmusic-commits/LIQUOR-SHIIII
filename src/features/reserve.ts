import { db } from "../db.js";
import { size, totalLine, unitPrice } from "../format.js";
import { getStock } from "../inventory.js";
import type { StoreStatus } from "../guardrails.js";
import type { ItemRequest, PriceMode } from "../types.js";
import { resolve } from "./stock.js";

export const HOLD_MINUTES = 120;

/**
 * Holds items for pickup: 2 hours, or until closing if sooner. Held qty stops counting as available
 * (see getStock); once expiresAt passes the hold quietly lapses, no cleanup job needed.
 */
export async function reserve(
  store: { id: string; priceMode: string },
  phone: string,
  items: ItemRequest[],
  status: StoreStatus,
  now: Date,
): Promise<string> {
  const mode = store.priceMode as PriceMode;
  if (!status.open) return `Abhi hold nahi ho sakta. ${status.note ?? ""}`.trim();
  if (!items.length) return `Kya hold karna hai? Brand aur size bataiye, jaise "2 full BP hold kar do".`;

  // shortcut: check-then-insert without a lock; fine on single-process SQLite, needs a row lock on Postgres.
  const stock = await getStock(store.id, now);
  const picks: { id: number; name: string; price: number; qty: number }[] = [];
  for (const req of items) {
    const r = resolve(req, stock);
    if (r.kind === "not_stocked") return `${r.brand} hamare paas nahi hai, isliye hold nahi ho sakta.`;
    if (r.kind !== "sku") return `${r.brand} ka kaunsa size hold karun? Quarter, half ya full?`;
    if (r.row.available < r.qty)
      return r.row.available
        ? `${r.row.brand} ${size(r.row.sizeMl)} sirf ${r.row.available} ${r.row.available === 1 ? "bachi hai" : "bachi hain"}. Utni hold kar doon?`
        : `${r.row.brand} ${size(r.row.sizeMl)} abhi khatam hai, hold nahi ho sakta.`;
    picks.push({ id: r.row.id, name: `${r.row.brand} ${size(r.row.sizeMl)}`, price: r.row.priceInr, qty: r.qty });
  }

  const expiresAt = new Date(Math.min(now.getTime() + HOLD_MINUTES * 60_000, status.closesAt.getTime()));
  const res = await db.reservation.create({
    data: {
      storeId: store.id,
      phone,
      expiresAt,
      items: { create: picks.map((p) => ({ storeId: store.id, itemId: p.id, qty: p.qty })) },
    },
  });
  const until = expiresAt.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
  const total = picks.reduce((t, p) => t + p.price * p.qty, 0);
  return [
    `✅ Hold ho gaya! Booking no. *#${res.id}*`,
    ...picks.map((p) => `• ${p.qty} × ${p.name}${unitPrice(mode, p.price, p.qty)}`),
    totalLine(mode, total),
    `⏰ ${until} tak rakha hai, uske baad apne aap cancel.`,
    `💵 Payment counter pe hogi. Age proof (ID) saath laiye, 25+ zaroori hai. Delivery nahi hoti, sirf store pickup.`,
  ].join("\n");
}
