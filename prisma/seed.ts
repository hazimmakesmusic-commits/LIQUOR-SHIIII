import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { db } from "../src/db.js";
import { CsvConnector } from "../src/connectors/csv.js";
import { syncInventory } from "../src/inventory.js";

const STORES = [
  { id: "saket", name: "Saket Wine Shop", priceMode: "full" },
  { id: "gk2", name: "GK-2 Liquor Point", priceMode: "totals_only" },
];

// Fixed national dry days only. Add Delhi Excise's notified list (festivals, elections) each year.
const DRY_DAYS = [
  ["2026-01-26", "Republic Day"], ["2026-08-15", "Independence Day"], ["2026-10-02", "Gandhi Jayanti"],
  ["2027-01-26", "Republic Day"], ["2027-08-15", "Independence Day"], ["2027-10-02", "Gandhi Jayanti"],
];

const brandInfo: Record<string, string>[] = parse(await readFile("data/brand_info.csv", "utf8"), { columns: true, trim: true });

for (const s of STORES) {
  await db.store.upsert({ where: { id: s.id }, create: s, update: s });
  const sync = await syncInventory(s.id, new CsvConnector("data/inventory.csv"));
  if (sync.errors.length) console.warn(`${s.id}: skipped rows`, sync.errors);
  for (const b of brandInfo) {
    const data = { aliases: b.aliases, origin: b.origin, tasteNotes: b.taste_notes, howToDrink: b.how_to_drink, funFact: b.fun_fact };
    await db.brandInfo.upsert({ where: { storeId_brand: { storeId: s.id, brand: b.brand } }, create: { storeId: s.id, brand: b.brand, ...data }, update: data });
  }
  for (const [date, reason] of DRY_DAYS)
    await db.dryDay.upsert({ where: { storeId_date: { storeId: s.id, date } }, create: { storeId: s.id, date, reason }, update: { reason } });
  console.log(`Seeded ${s.name}: ${sync.imported} SKUs, ${brandInfo.length} brand facts`);
}
await db.$disconnect();
