import type { CatalogEntry, ItemRequest } from "./types.js";

// Delhi counter slang. quarter/pauwa=180, half/adha=375, full/botal=750 (beer snaps to 650 later).
const SIZE_WORDS: Record<string, number> = {
  quarter: 180, qtr: 180, pauwa: 180, pauva: 180, pavva: 180, adhiya: 180,
  half: 375, adha: 375, addha: 375, aadha: 375, nip: 180, pint: 375,
  full: 750, botal: 750, khamba: 750,
};
const SIZE_NUMBERS = new Set([180, 375, 500, 650, 750, 1000]);
const QTY_WORDS: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4,
  paanch: 5, panch: 5, five: 5, chhe: 6, six: 6,
};
// Words allowed between a brand and its size/qty ("BP ki 2 half", "750 ml", "2 bottle KF").
const FILLERS = new Set(["ki", "ka", "ke", "wali", "wala", "waali", "ml", "bottle", "bottles", "x", "pcs", "piece", "pieces"]);
export const PEG_ML = { small: 30, large: 60, patiala: 90 } as const;

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

type Mod = { size?: number; qty?: number };

/** Reads a size or quantity from one token; null means "not a modifier, stop scanning". */
function readModifier(tok: string): Mod | null | "skip" {
  if (tok in SIZE_WORDS) return { size: SIZE_WORDS[tok] };
  if (tok in QTY_WORDS) return { qty: QTY_WORDS[tok] };
  if (/^\d+$/.test(tok)) {
    const n = Number(tok);
    if (SIZE_NUMBERS.has(n)) return { size: n };
    if (n >= 1 && n <= 48) return { qty: n };
    return null;
  }
  return FILLERS.has(tok) ? "skip" : null;
}

/**
 * Finds brand mentions (by name or slang alias) and the size/qty words next to them.
 * "2 full BP aur 1 half OM" -> [{Blenders Pride, 750, 2}, {Old Monk, 375, 1}]
 */
export function parseItems(text: string, catalog: CatalogEntry[]): ItemRequest[] {
  const tokens = tokenize(text);
  const aliases = catalog
    .flatMap((c) => [c.brand, ...c.aliases].map((a) => ({ brand: c.brand, toks: tokenize(a) })))
    .filter((a) => a.toks.length)
    .sort((a, b) => b.toks.length - a.toks.length); // longest first: "kf strong" beats "kf"

  const matches: { brand: string; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = aliases.find((a) => a.toks.every((t, k) => tokens[i + k] === t));
    if (hit) {
      matches.push({ brand: hit.brand, start: i, end: i + hit.toks.length });
      i += hit.toks.length;
    } else i++;
  }

  return matches.map((m, idx) => {
    const lo = idx > 0 ? matches[idx - 1].end : 0;
    const hi = idx < matches.length - 1 ? matches[idx + 1].start : tokens.length;
    const found: Mod = {};
    const take = (tok: string) => {
      const mod = readModifier(tok);
      if (mod === null) return false;
      if (mod !== "skip") {
        if (mod.size && !found.size) found.size = mod.size;
        if (mod.qty && !found.qty) found.qty = mod.qty;
      }
      return true;
    };
    for (let j = m.start - 1; j >= Math.max(lo, m.start - 4) && take(tokens[j]); j--);
    for (let j = m.end; j < Math.min(hi, m.end + 4) && take(tokens[j]); j++);
    return { brand: m.brand, sizeMl: found.size ?? null, qty: found.qty ?? 1 };
  });
}

/** "4 large peg each" -> 4 drinks (1 drink = 60ml large peg). Null if no pegs mentioned. */
export function parsePegs(text: string): number | null {
  const m = tokenize(text).join(" ").match(/(\d+)\s*(small|large|patiala)?\s*pegs?/);
  if (!m) return null;
  const ml = PEG_ML[(m[2] as keyof typeof PEG_ML) ?? "large"];
  return (Number(m[1]) * ml) / PEG_ML.large;
}
