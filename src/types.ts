export const CATEGORIES = ["whisky", "rum", "vodka", "beer", "gin", "wine"] as const;
export type Category = (typeof CATEGORIES)[number];
export const TIERS = ["budget", "mid", "premium"] as const;
export type PriceMode = "full" | "totals_only" | "none";

/** One sellable SKU with what's actually free to sell right now (qty minus active holds). */
export type StockRow = {
  id: number;
  brand: string;
  category: string;
  sizeMl: number;
  priceInr: number;
  tier: string;
  available: number;
};

export type ItemRequest = { brand: string; category?: Category | null; sizeMl: number | null; qty: number };

export type Understanding = {
  intent: "stock_check" | "budget_plan" | "trivia" | "reserve" | "other";
  items: ItemRequest[];
  budgetInr: number | null;
  headcount: number | null;
  preferences: Category[];
  level: "light" | "normal" | "long_night" | null;
  drinksPerPerson: number | null;
  question: string | null;
};

export type CatalogEntry = { brand: string; category: string; aliases: string[] };
