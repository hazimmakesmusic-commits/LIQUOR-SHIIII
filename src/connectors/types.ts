import { z } from "zod";
import { CATEGORIES, TIERS } from "../types.js";

/** One row as any source (CSV, Google Sheet, Tally, Marg, GoFrugal...) must deliver it. */
export const InventoryRowSchema = z.object({
  brand: z.string().trim().min(1),
  category: z.enum(CATEGORIES),
  size_ml: z.coerce.number().int().positive(),
  price_inr: z.coerce.number().int().nonnegative(),
  qty: z.coerce.number().int().nonnegative(),
  tier: z.enum(TIERS),
});
export type InventoryRow = z.infer<typeof InventoryRowSchema>;

/** Every inventory source implements this. A POS connector only has to return full stock rows. */
export interface InventoryConnector {
  readonly name: string;
  /** Full current stock. Rows that fail validation are reported, not imported. */
  fetch(): Promise<{ rows: InventoryRow[]; errors: string[] }>;
}
