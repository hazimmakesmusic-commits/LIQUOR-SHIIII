import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { InventoryRowSchema, type InventoryConnector, type InventoryRow } from "./types.js";

/**
 * CSV file path, or any CSV URL. For a Google Sheet: File > Share > Publish to web > CSV,
 * then use that link. Header: brand,category,size_ml,price_inr,qty,tier
 */
export class CsvConnector implements InventoryConnector {
  readonly name = "csv";
  constructor(private source: string) {}

  async fetch() {
    const text = /^https?:\/\//.test(this.source)
      ? await fetch(this.source).then((r) => {
          if (!r.ok) throw new Error(`CSV download failed: HTTP ${r.status}`);
          return r.text();
        })
      : await readFile(this.source, "utf8");
    const records: Record<string, string>[] = parse(text, { columns: true, skip_empty_lines: true, trim: true });
    const rows: InventoryRow[] = [];
    const errors: string[] = [];
    records.forEach((rec, i) => {
      const lower = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));
      const parsed = InventoryRowSchema.safeParse({ ...lower, category: lower.category?.toLowerCase(), tier: lower.tier?.toLowerCase() });
      if (parsed.success) rows.push(parsed.data);
      else errors.push(`row ${i + 2}: ${parsed.error.issues.map((e) => `${e.path.join(".")} ${e.message}`).join("; ")}`);
    });
    return { rows, errors };
  }
}
