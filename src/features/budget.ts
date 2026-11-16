import type { Category, StockRow } from "../types.js";

// One "drink" = 60ml large peg of spirit, half a 650ml beer, or a 150ml glass of wine.
const ML_PER_DRINK: Record<Category, number> = { whisky: 60, rum: 60, vodka: 60, gin: 60, beer: 325, wine: 150 };
export const DRINKS_PER_PERSON = { light: 2, normal: 3.5, long_night: 6 } as const;
const BUDGET_CAP = 0.95;
const TIER_RANK: Record<string, number> = { budget: 0, mid: 1, premium: 2 };

export type Line = { brand: string; sizeMl: number; count: number; unitPrice: number; lineTotal: number };
export type Combo = { label: string; lines: Line[]; total: number; drinksPerPerson: number; mixers: Mixer[] };
export type Mixer = { name: string; count: number; unitPrice: number };
export type BudgetInput = {
  budgetInr: number;
  headcount: number;
  categories: Category[];
  drinksPerPerson: number;
};
export type BudgetPlan = { combos: Combo[]; requestedDrinksPerPerson: number; tight: boolean };

/** Cheapest mix of one brand's bottle sizes covering at least `ml`, within available stock. */
export function coverCheapest(skus: StockRow[], ml: number): { lines: Line[]; cost: number } | null {
  const s = [...skus].filter((r) => r.available > 0).sort((a, b) => b.sizeMl - a.sizeMl);
  if (!s.length || ml <= 0) return null;
  let best: { counts: number[]; cost: number } | null = null;
  const counts = new Array(s.length).fill(0);
  const search = (i: number, remaining: number, cost: number) => {
    if (best && cost >= best.cost) return;
    if (remaining <= 0) {
      best = { counts: [...counts], cost };
      return;
    }
    if (i === s.length) return;
    const max = Math.min(s[i].available, Math.ceil(remaining / s[i].sizeMl));
    for (let n = max; n >= 0; n--) {
      counts[i] = n;
      search(i + 1, remaining - n * s[i].sizeMl, cost + n * s[i].priceInr);
    }
    counts[i] = 0;
  };
  search(0, ml, 0);
  if (!best) return null;
  const { counts: c, cost } = best as { counts: number[]; cost: number };
  const lines = s
    .map((r, i) => ({ brand: r.brand, sizeMl: r.sizeMl, count: c[i], unitPrice: r.priceInr, lineTotal: c[i] * r.priceInr }))
    .filter((l) => l.count > 0);
  return { lines, cost };
}

type Option = { brand: string; tier: string; lines: Line[]; cost: number };

/** Every brand in a category that can cover `ml`, cheapest first. */
function optionsFor(stock: StockRow[], category: Category, ml: number): Option[] {
  const byBrand = new Map<string, StockRow[]>();
  for (const r of stock) if (r.category === category) byBrand.set(r.brand, [...(byBrand.get(r.brand) ?? []), r]);
  return [...byBrand.values()]
    .map((skus) => ({ skus, cover: coverCheapest(skus, ml) }))
    .filter((o) => o.cover)
    .map(({ skus, cover }) => ({ brand: skus[0].brand, tier: skus[0].tier, ...cover! }))
    .sort((a, b) => a.cost - b.cost);
}

function mlNeeded(input: BudgetInput, factor: number): Map<Category, number> {
  const drinksEach = (input.headcount * input.drinksPerPerson * factor) / input.categories.length;
  return new Map(input.categories.map((c) => [c, drinksEach * ML_PER_DRINK[c]]));
}

function cheapestPicks(stock: StockRow[], input: BudgetInput, factor: number): Option[] | null {
  const picks = [...mlNeeded(input, factor)].map(([c, ml]) => optionsFor(stock, c, ml)[0]);
  return picks.every(Boolean) ? picks : null;
}

const sum = (opts: Option[]) => opts.reduce((t, o) => t + o.cost, 0);

// shortcut: mixer prices are rough Delhi kirana prices, hardcoded; move to store config if stores sell mixers.
function suggestMixers(headcount: number, categories: Category[], leftover: number): Mixer[] {
  const wanted: Mixer[] = [{ name: "ice pack", count: Math.ceil(headcount / 4), unitPrice: 50 }];
  if (categories.includes("whisky")) wanted.push({ name: "soda (750ml)", count: Math.ceil(headcount / 2), unitPrice: 20 });
  if (categories.some((c) => c === "rum" || c === "vodka")) wanted.push({ name: "cola (2L)", count: Math.ceil(headcount / 5), unitPrice: 100 });
  if (categories.includes("gin")) wanted.push({ name: "tonic water", count: headcount, unitPrice: 60 });
  const out: Mixer[] = [];
  for (const m of wanted) {
    const count = Math.min(m.count, Math.floor(leftover / m.unitPrice));
    if (count > 0) {
      out.push({ ...m, count });
      leftover -= count * m.unitPrice;
    }
  }
  return out;
}

/**
 * Builds up to 3 combos (Best value / Better brand / More quantity) from in-stock items,
 * each at most 95% of the budget. If even the cheapest plan doesn't fit, it scales drinks down
 * and marks the plan `tight`.
 */
export function planBudget(input: BudgetInput, stock: StockRow[]): BudgetPlan {
  const cap = Math.floor(input.budgetInr * BUDGET_CAP);
  const toCombo = (label: string, opts: Option[], factor: number): Combo => {
    const total = sum(opts);
    return {
      label,
      lines: opts.flatMap((o) => o.lines),
      total,
      drinksPerPerson: Math.round(input.drinksPerPerson * factor * 10) / 10,
      mixers: suggestMixers(input.headcount, input.categories, input.budgetInr - total),
    };
  };

  // Best value: cheapest brands for the full drink count; scale down if the budget is tight.
  let baseFactor = 1;
  let base = cheapestPicks(stock, input, 1);
  while (baseFactor > 0.25 && (!base || sum(base) > cap)) {
    baseFactor = Math.round((baseFactor - 0.1) * 10) / 10;
    base = cheapestPicks(stock, input, baseFactor);
  }
  if (!base || sum(base) > cap) return { combos: [], requestedDrinksPerPerson: input.drinksPerPerson, tight: true };
  const combos = [toCombo("Best value", base, baseFactor)];

  // Better brand: same quantity, each category moves up a tier using an equal share of the spare budget
  // (so one category can't eat it all and leave the others on the cheapest stuff).
  const ml = [...mlNeeded(input, baseFactor).values()];
  const share = (cap - sum(base)) / input.categories.length;
  const upgraded = input.categories.map((c, i) => {
    const fit = optionsFor(stock, c, ml[i])
      .filter((o) => TIER_RANK[o.tier] > TIER_RANK[base![i].tier] && o.cost <= base![i].cost + share)
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.cost - a.cost)[0];
    return fit ?? base![i];
  });
  if (upgraded.some((o, i) => o.brand !== base![i].brand)) combos.push(toCombo("Better brand", upgraded, baseFactor));

  // More quantity: cheapest brands, as much extra as the budget allows (up to +50%).
  for (const f of [1.5, 1.4, 1.3, 1.2]) {
    if (baseFactor < 1) break;
    const more = cheapestPicks(stock, input, f);
    if (more && sum(more) <= cap) {
      combos.push(toCombo("More quantity", more, f));
      break;
    }
  }

  return { combos, requestedDrinksPerPerson: input.drinksPerPerson, tight: baseFactor < 1 };
}

/** WhatsApp text for a plan, honouring priceMode (none = no rupee amounts at all). */
export function budgetReply(plan: BudgetPlan, input: BudgetInput, mode: "full" | "totals_only" | "none"): string {
  const rs = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const nick: Record<number, string> = { 180: "quarter", 375: "half", 750: "full", 650: "beer" };
  const head = `🎉 ${input.headcount} log, ${rs(input.budgetInr)} budget, ${input.categories.join(" + ")}:`;
  if (!plan.combos.length)
    return `${head}\nIs budget me in-stock items se plan nahi ban raha 😕 Budget thoda badhayein ya category badal ke dekhein (jaise beer ya rum).`;
  const out = [head];
  if (plan.tight)
    out.push(`⚠️ Budget thoda tight hai: ${plan.requestedDrinksPerPerson} drinks/person ki jagah ~${plan.combos[0].drinksPerPerson} ban payenge.`);
  for (const c of plan.combos) {
    out.push(`\n*${c.label}* (~${c.drinksPerPerson} drinks/person)`);
    for (const l of c.lines)
      out.push(`• ${l.count} × ${l.brand} ${l.sizeMl}ml (${nick[l.sizeMl] ?? ""})${mode === "full" ? ` – ${rs(l.lineTotal)}` : ""}`.replace(" ()", ""));
    if (mode !== "none") out.push(`  Total: *${rs(c.total)}*`);
    if (c.mixers.length)
      out.push(`  Bache paise me: ${c.mixers.map((m) => `${m.count} ${m.name}${mode === "full" ? ` (~${rs(m.count * m.unitPrice)})` : ""}`).join(", ")}`);
  }
  if (mode === "none") out.push(`\nPrice counter pe confirm kar lijiye.`);
  out.push(`\nKoi combo hold karun? Items likh ke "hold kar do" bhejiye.`);
  out.push(`🙏 Aaram se piyein, beech me paani, aur peeke drive bilkul nahi. 🚗❌`);
  return out.join("\n");
}
