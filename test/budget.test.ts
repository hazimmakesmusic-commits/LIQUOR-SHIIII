import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetReply, coverCheapest, planBudget, type BudgetInput } from "../src/features/budget.js";
import type { StockRow } from "../src/types.js";

let id = 0;
const row = (brand: string, category: string, sizeMl: number, priceInr: number, tier: string, available = 50): StockRow => ({
  id: ++id, brand, category, sizeMl, priceInr, tier, available,
});

const stock: StockRow[] = [
  row("OC", "whisky", 180, 130, "budget"),
  row("OC", "whisky", 750, 500, "budget"),
  row("RS", "whisky", 375, 350, "mid"),
  row("RS", "whisky", 750, 700, "mid"),
  row("BP", "whisky", 750, 1100, "mid"),
  row("JW Red", "whisky", 750, 1950, "premium", 3),
  row("KF", "beer", 650, 160, "budget"),
  row("Bud", "beer", 650, 220, "mid"),
  row("OM", "rum", 750, 530, "budget"),
];
const input = (o: Partial<BudgetInput> = {}): BudgetInput => ({ budgetInr: 5000, headcount: 6, categories: ["whisky", "beer"], drinksPerPerson: 3.5, ...o });

test("coverCheapest mixes sizes to cover the volume at least cost", () => {
  const r = coverCheapest(stock.filter((s) => s.brand === "OC"), 900); // 750 + 180
  assert.equal(r?.cost, 630);
  assert.deepEqual(r?.lines.map((l) => [l.sizeMl, l.count]), [[750, 1], [180, 1]]);
});

test("coverCheapest respects available stock", () => {
  const r = coverCheapest([row("X", "whisky", 750, 500, "budget", 1), row("X", "whisky", 180, 130, "budget", 10)], 1500);
  assert.deepEqual(r?.lines.map((l) => [l.sizeMl, l.count]), [[750, 1], [180, 5]]);
  assert.equal(coverCheapest([row("Y", "whisky", 750, 500, "budget", 0)], 100), null);
});

test("every combo stays within 95% of budget and uses only in-stock items", () => {
  for (const budgetInr of [1500, 3000, 5000, 12000]) {
    const plan = planBudget(input({ budgetInr }), stock);
    for (const c of plan.combos) {
      assert.ok(c.total <= budgetInr * 0.95, `${c.label} ${c.total} > 95% of ${budgetInr}`);
      assert.equal(c.total, c.lines.reduce((t, l) => t + l.lineTotal, 0));
      for (const l of c.lines) assert.ok(stock.some((s) => s.brand === l.brand && s.sizeMl === l.sizeMl && s.available >= l.count));
    }
  }
});

test("roomy budget gives Best value, Better brand and More quantity", () => {
  const plan = planBudget(input({ budgetInr: 8000 }), stock);
  assert.deepEqual(plan.combos.map((c) => c.label), ["Best value", "Better brand", "More quantity"]);
  assert.equal(plan.tight, false);
  const [value, better, more] = plan.combos;
  assert.ok(better.total > value.total);
  assert.ok(more.drinksPerPerson > value.drinksPerPerson);
  // 6 people x 3.5 drinks, half whisky: 10.5 x 60ml = 630ml -> one OC full is the cheapest cover.
  assert.deepEqual(value.lines.find((l) => l.brand === "OC"), { brand: "OC", sizeMl: 750, count: 1, unitPrice: 500, lineTotal: 500 });
});

test("tight budget scales drinks down and says so", () => {
  const plan = planBudget(input({ budgetInr: 1200, headcount: 10 }), stock);
  assert.equal(plan.tight, true);
  assert.ok(plan.combos[0].drinksPerPerson < 3.5);
  assert.ok(plan.combos[0].total <= 1140);
});

test("impossible budget returns no combos", () => {
  assert.deepEqual(planBudget(input({ budgetInr: 100 }), stock).combos, []);
});

test("leftover money goes to mixers, never past the budget", () => {
  const plan = planBudget(input({ budgetInr: 3000 }), stock);
  for (const c of plan.combos) {
    const mixerCost = c.mixers.reduce((t, m) => t + m.count * m.unitPrice, 0);
    assert.ok(c.total + mixerCost <= 3000);
  }
  assert.ok(plan.combos[0].mixers.some((m) => m.name === "ice pack"));
});

test("priceMode none hides every rupee amount; responsible line always present", () => {
  const i = input({ budgetInr: 8000 });
  const plan = planBudget(i, stock);
  const none = budgetReply(plan, i, "none");
  assert.ok(!/₹\s?\d/.test(none.replace("₹8,000 budget", "")), none);
  assert.match(none, /drive bilkul nahi/);
  assert.match(budgetReply(plan, i, "full"), /OC 750ml \(full\) – ₹500/);
  assert.doesNotMatch(budgetReply(plan, i, "totals_only"), /OC 750ml \(full\) – ₹/);
});
