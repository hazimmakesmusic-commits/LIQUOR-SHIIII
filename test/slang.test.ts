import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { parseItems, parsePegs, wordsToDigits } from "../src/slang.js";
import { ruleBased } from "../src/understand.js";
import type { CatalogEntry } from "../src/types.js";

const rows: Record<string, string>[] = parse(readFileSync("data/brand_info.csv", "utf8"), { columns: true });
const catalog: CatalogEntry[] = rows.map((r) => ({ brand: r.brand, category: "", aliases: r.aliases.split("|") }));
const p = (t: string) => parseItems(t, catalog);

test("slang brand + size: OM half", () => {
  assert.deepEqual(p("OM half hai?"), [{ brand: "Old Monk", sizeMl: 375, qty: 1 }]);
});

test("qty before size before brand: 2 full BP", () => {
  assert.deepEqual(p("2 full BP"), [{ brand: "Blenders Pride", sizeMl: 750, qty: 2 }]);
});

test("longest alias wins: KF strong is not plain KF", () => {
  assert.deepEqual(p("KF strong"), [{ brand: "Kingfisher Strong", sizeMl: null, qty: 1 }]);
  assert.deepEqual(p("4 kf"), [{ brand: "Kingfisher Premium", sizeMl: null, qty: 4 }]);
});

test("several items in one message", () => {
  assert.deepEqual(p("2 full BP aur 1 half OM aur 6 KF strong"), [
    { brand: "Blenders Pride", sizeMl: 750, qty: 2 },
    { brand: "Old Monk", sizeMl: 375, qty: 1 },
    { brand: "Kingfisher Strong", sizeMl: null, qty: 6 },
  ]);
});

test("quarter, ml numbers, glued tokens, Hindi numbers", () => {
  assert.deepEqual(p("ek quarter magic moments"), [{ brand: "Magic Moments", sizeMl: 180, qty: 1 }]);
  assert.deepEqual(p("RS 750ml"), []); // "rs" is rupees, not Royal Stag
  assert.deepEqual(p("royal stag 375ml x2"), [{ brand: "Royal Stag", sizeMl: 375, qty: 2 }]);
  assert.deepEqual(p("do pauwa officer's choice"), [{ brand: "Officer's Choice", sizeMl: 180, qty: 2 }]);
});

test("'do' meaning 'give' is not read as a quantity", () => {
  assert.deepEqual(p("BP full de do"), [{ brand: "Blenders Pride", sizeMl: 750, qty: 1 }]);
});

test("budget amounts are not quantities", () => {
  assert.deepEqual(p("5000 me jack daniels"), [{ brand: "Jack Daniel's", sizeMl: null, qty: 1 }]);
});

test("pegs convert to 60ml drinks", () => {
  assert.equal(parsePegs("4 large peg each"), 4);
  assert.equal(parsePegs("4 small pegs"), 2);
  assert.equal(parsePegs("2 patiala peg"), 3);
  assert.equal(parsePegs("koi peg nahi"), null);
});

test("rule-based intents", () => {
  assert.equal(ruleBased("OM half hai?", catalog).intent, "stock_check");
  const b = ruleBased("6 log hain, 5000 ka budget, whisky aur beer", catalog);
  assert.equal(b.intent, "budget_plan");
  assert.equal(b.budgetInr, 5000);
  assert.equal(b.headcount, 6);
  assert.deepEqual(b.preferences, ["whisky", "beer"]);
  assert.equal(ruleBased("BP 750 me hai?", catalog).intent, "stock_check");
  assert.equal(ruleBased("2 full BP hold kar do", catalog).intent, "reserve");
  assert.equal(ruleBased("Jameson kaisi hoti hai", catalog).intent, "trivia");
  assert.equal(ruleBased("hello", catalog).intent, "other");
});

test("spoken numbers from voice notes become digits", () => {
  assert.equal(wordsToDigits("chhah hazaar ke budget mein"), "6000 ke budget mein");
  assert.equal(wordsToDigits("do hazaar paanch sau"), "2500");
  assert.equal(wordsToDigits("dedh hazaar, saadhe teen hazaar, 5 hazaar"), "1500 3500 5000");
  assert.equal(wordsToDigits("hum do log hain"), "hum 2 log hain");
  assert.equal(wordsToDigits("BP full de do"), "bp full de do"); // "do" = give
  assert.equal(wordsToDigits("2 full BP"), "2 full bp");
});

test("the real voice note: 6 people, 6000 budget, beer", () => {
  const u = ruleBased(
    "Toh hum chhah log hain, office ki party hai aur jismein se chaar ladkiyan hain aur jismein se do bas beer peeti hain. So chhah hazaar ke budget mein kya aa sakta hai?",
    catalog,
  );
  assert.equal(u.intent, "budget_plan");
  assert.equal(u.headcount, 6);
  assert.equal(u.budgetInr, 6000);
  assert.ok(u.preferences.includes("beer"));
});
