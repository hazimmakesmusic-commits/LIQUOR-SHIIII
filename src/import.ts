// Usage: npm run import -- <storeId> <csv file or published Google Sheet CSV URL>
import { db } from "./db.js";
import { CsvConnector } from "./connectors/csv.js";
import { syncInventory } from "./inventory.js";

const [storeId, source] = process.argv.slice(2);
if (!storeId || !source) {
  console.error("Usage: npm run import -- <storeId> <csv file or URL>");
  process.exit(1);
}
if (!(await db.store.findUnique({ where: { id: storeId } }))) {
  console.error(`No store "${storeId}". Run npm run setup first or check the id.`);
  process.exit(1);
}
const r = await syncInventory(storeId, new CsvConnector(source));
console.log(`Imported ${r.imported} rows, set ${r.zeroed} missing SKUs to qty 0.`);
if (r.errors.length) console.warn("Skipped invalid rows:\n" + r.errors.join("\n"));
await db.$disconnect();
