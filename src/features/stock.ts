import { db } from "../db.js";
import { size, sizesLine, totalLine, unitPrice } from "../format.js";
import type { ItemRequest, PriceMode, StockRow } from "../types.js";

export const LOW_STOCK = 2;

export type Resolved =
  | { kind: "sku"; row: StockRow; qty: number }
  | { kind: "pick_size"; brand: string; rows: StockRow[] }
  | { kind: "size_missing"; brand: string; sizeMl: number; rows: StockRow[] }
  | { kind: "not_stocked"; brand: string; category: string | null };

/** Turns a parsed request into a concrete SKU (or the reason it can't). Beer "full" snaps to the only size. */
export function resolve(req: ItemRequest, stock: StockRow[]): Resolved {
  const rows = stock.filter((r) => r.brand.toLowerCase() === req.brand.toLowerCase());
  if (!rows.length) return { kind: "not_stocked", brand: req.brand, category: req.category ?? null };
  const exact = req.sizeMl ? rows.find((r) => r.sizeMl === req.sizeMl) : undefined;
  if (exact || rows.length === 1) return { kind: "sku", row: exact ?? rows[0], qty: req.qty };
  if (!req.sizeMl) return { kind: "pick_size", brand: rows[0].brand, rows };
  return { kind: "size_missing", brand: rows[0].brand, sizeMl: req.sizeMl, rows };
}

/** Two in-stock picks from the same category, closest in price (same size preferred). */
export function alternatives(stock: StockRow[], category: string | null, brand: string, sizeMl?: number, price?: number): StockRow[] {
  const pool = stock.filter((r) => r.category === category && r.brand !== brand && r.available > 0);
  const sameSize = pool.filter((r) => r.sizeMl === (sizeMl ?? 750) || r.category === "beer");
  const cands = sameSize.length >= 2 ? sameSize : pool;
  // Unknown brand with no price to compare: people asking for brands we don't carry usually want premium.
  const target = price ?? Math.max(...cands.map((r) => r.priceInr));
  return [...cands].sort((a, b) => Math.abs(a.priceInr - target) - Math.abs(b.priceInr - target)).slice(0, 2);
}

const altText = (mode: PriceMode, alts: StockRow[]) =>
  alts.length ? `\n   Iski jagah le sakte ho: ${alts.map((a) => `${a.brand} ${size(a.sizeMl)}${unitPrice(mode, a.priceInr)}`).join(" | ")}` : "";

/** Stock-check reply. Logs demand per item (Phase 3 missed-demand report) and returns SKUs to remember for "reserve kar do". */
export async function stockCheck(storeId: string, mode: PriceMode, items: ItemRequest[], stock: StockRow[]) {
  const lines: string[] = [];
  const remember: { brand: string; sizeMl: number; qty: number }[] = [];
  const demand: { brand: string; sizeMl: number | null; outcome: string }[] = [];
  let total = 0;

  for (const req of items) {
    const r = resolve(req, stock);
    if (r.kind === "not_stocked") {
      demand.push({ brand: r.brand, sizeMl: req.sizeMl, outcome: "not_stocked" });
      lines.push(`❌ ${r.brand} hamare paas nahi milti.${altText(mode, alternatives(stock, r.category, r.brand, req.sizeMl ?? undefined))}`);
    } else if (r.kind === "pick_size" || r.kind === "size_missing") {
      const avail = sizesLine(mode, r.rows);
      const out = !avail;
      demand.push({ brand: r.brand, sizeMl: req.sizeMl, outcome: out ? "out_of_stock" : r.kind === "size_missing" ? "not_stocked" : "in_stock" });
      lines.push(
        out
          ? `❌ ${r.brand} abhi khatam hai.${altText(mode, alternatives(stock, r.rows[0].category, r.brand, 750, r.rows[0].priceInr))}`
          : r.kind === "size_missing"
            ? `${r.brand} ${size(r.sizeMl)} nahi aati. Available: ${avail}`
            : `✅ ${r.brand} available hai: ${avail}. Kaunsa size chahiye?`,
      );
    } else {
      const { row, qty } = r;
      const outcome = row.available === 0 ? "out_of_stock" : row.available <= LOW_STOCK ? "low" : "in_stock";
      demand.push({ brand: row.brand, sizeMl: row.sizeMl, outcome });
      const name = `${row.brand} ${size(row.sizeMl)}`;
      if (row.available === 0) {
        lines.push(`❌ ${name} abhi khatam hai.${altText(mode, alternatives(stock, row.category, row.brand, row.sizeMl, row.priceInr))}`);
        continue;
      }
      const n = Math.min(qty, row.available);
      total += row.priceInr * n;
      remember.push({ brand: row.brand, sizeMl: row.sizeMl, qty: n });
      const scarcity =
        qty > row.available ? ` (sirf ${row.available} ${row.available === 1 ? "bachi hai" : "bachi hain"}, aapne ${qty} maangi)`
        : row.available <= LOW_STOCK ? ` (⚠️ sirf ${row.available} ${row.available === 1 ? "bachi hai" : "bachi hain"}!)`
        : "";
      lines.push(`✅ ${n > 1 && mode !== "full" ? `${n} × ` : ""}${name}${unitPrice(mode, row.priceInr, n)}${scarcity}`);
    }
  }

  await db.demandEvent.createMany({ data: demand.map((d) => ({ storeId, ...d })) });
  if (remember.length) {
    if (mode !== "full" || remember.length > 1 || remember[0].qty > 1) lines.push(totalLine(mode, total));
    lines.push(`2 ghante ke liye pickup hold karun? Bas "hold kar do" likhiye.`);
  }
  return { reply: lines.join("\n"), remember };
}
