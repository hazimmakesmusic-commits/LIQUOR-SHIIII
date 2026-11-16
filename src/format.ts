import type { PriceMode, StockRow } from "./types.js";

const NICK: Record<number, string> = { 180: "quarter", 375: "half", 750: "full" };
export const size = (ml: number) => (NICK[ml] ? `${ml}ml (${NICK[ml]})` : `${ml}ml`);
export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** Unit price text for one line, or "" when the store has per-item prices switched off. */
export const unitPrice = (mode: PriceMode, price: number, qty = 1) =>
  mode !== "full" ? "" : qty > 1 ? ` – ${inr(price)} × ${qty} = ${inr(price * qty)}` : ` – ${inr(price)}`;

/** Closing total line, honouring the store's priceMode. */
export const totalLine = (mode: PriceMode, total: number) =>
  mode === "none" ? "Price counter pe confirm kar lijiye." : `*Total: ${inr(total)}*`;

/** "Old Monk: quarter ₹140, half ₹270" for in-stock sizes of one brand. */
export function sizesLine(mode: PriceMode, rows: StockRow[]) {
  return rows
    .filter((r) => r.available > 0)
    .sort((a, b) => a.sizeMl - b.sizeMl)
    .map((r) => `${size(r.sizeMl)}${mode === "full" ? ` ${inr(r.priceInr)}` : ""}`)
    .join(", ");
}
