import { db } from "./db.js";
import type { InventoryConnector } from "./connectors/types.js";
import type { CatalogEntry, StockRow } from "./types.js";

/** Stock with active (unexpired) pickup holds subtracted. Expired holds simply stop counting. */
export async function getStock(storeId: string, now = new Date()): Promise<StockRow[]> {
  const [items, holds] = await Promise.all([
    db.inventoryItem.findMany({ where: { storeId } }),
    db.reservationItem.findMany({
      where: { storeId, reservation: { status: "active", expiresAt: { gt: now } } },
    }),
  ]);
  const held = new Map<number, number>();
  for (const h of holds) held.set(h.itemId, (held.get(h.itemId) ?? 0) + h.qty);
  return items.map(({ id, brand, category, sizeMl, priceInr, tier, qty }) => ({
    id, brand, category, sizeMl, priceInr, tier,
    available: Math.max(0, qty - (held.get(id) ?? 0)),
  }));
}

/** Brands the store carries, with slang aliases from brand_info. Passed to the parser and to Claude. */
export async function getCatalog(storeId: string): Promise<CatalogEntry[]> {
  const [items, info] = await Promise.all([
    db.inventoryItem.findMany({ where: { storeId }, select: { brand: true, category: true }, distinct: ["brand"] }),
    db.brandInfo.findMany({ where: { storeId }, select: { brand: true, aliases: true } }),
  ]);
  const aliases = new Map(info.map((i) => [i.brand, i.aliases.split("|").map((a) => a.trim()).filter(Boolean)]));
  return items.map((i) => ({ brand: i.brand, category: i.category, aliases: aliases.get(i.brand) ?? [] }));
}

/**
 * Full sync from a connector: upsert every row; anything the source no longer lists goes to qty 0
 * (kept, not deleted, so old reservations still resolve).
 */
export async function syncInventory(storeId: string, connector: InventoryConnector) {
  const { rows, errors } = await connector.fetch();
  if (!rows.length) throw new Error(`No valid rows from ${connector.name}; nothing changed. ${errors.join(" | ")}`);
  const seen = await db.$transaction(
    rows.map((r) =>
      db.inventoryItem.upsert({
        where: { storeId_brand_sizeMl: { storeId, brand: r.brand, sizeMl: r.size_ml } },
        create: { storeId, brand: r.brand, category: r.category, sizeMl: r.size_ml, priceInr: r.price_inr, qty: r.qty, tier: r.tier },
        update: { category: r.category, priceInr: r.price_inr, qty: r.qty, tier: r.tier },
      }),
    ),
  );
  const zeroed = await db.inventoryItem.updateMany({
    where: { storeId, id: { notIn: seen.map((s) => s.id) } },
    data: { qty: 0 },
  });
  return { imported: rows.length, zeroed: zeroed.count, errors };
}
