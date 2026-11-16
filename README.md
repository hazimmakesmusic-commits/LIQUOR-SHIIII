# Liquor Store WhatsApp Bot — Phase 1

Enquiry-only chatbot for Delhi NCR liquor stores. It answers in Hinglish and handles stock checks, party budget plans, brand trivia, and 2-hour pickup holds. It is multi-tenant: every table has `storeId`. There's no WhatsApp connection yet; you test it in the browser at `/test`.

## Run it

Needs Node 22+.

```bash
npm install
cp .env.example .env   # then put your ANTHROPIC_API_KEY in .env
npm run setup     # creates prisma/dev.db and seeds 2 demo stores with ~50 brands
npm run dev       # http://localhost:3000/test
```

Without an API key, the bot still works using a built-in rule-based slang parser. It handles clear messages ("OM half hai?", "6 log 5000 budget whisky beer"). Claude is needed for messy ones, and for brands the store doesn't carry ("Monkey Shoulder hai?").

```bash
npm test          # unit tests: slang parsing + budget planner
npm run typecheck
```

On the test page:
- Reply **haan** first. That's the age gate; Delhi's legal age is 25.
- Use the **Prices** dropdown to switch a store's `priceMode` live.
- Click **New customer** to start a fresh chat.

## How it works

```
message ─► guardrails (age gate, no delivery)
        ─► understand()  Claude: intent + items as structured JSON   (src/understand.ts)
        │                fallback: rule-based slang parser             (src/slang.ts)
        ─► feature       plain code reading the DB                     (src/features/*)
        ─► reply         + store-closed / dry-day note                 (src/bot.ts)
```

Claude only *understands* the message. Prices, stock, budget maths and holds always come from the database, so the bot can't invent a price. Brand facts come only from the `brand_info` table; Claude is told to say it doesn't know rather than guess.

| Feature | Behaviour |
|---|---|
| Stock check | In stock: price. 2 or fewer left: "sirf 2 bachi hain". Out of stock: 2 alternatives in the same category, closest price. |
| Budget planner | Up to 3 combos (Best value / Better brand / More quantity) from in-stock items only. Each stays within 95% of the budget. Leftover money goes to ice and mixers. Ends with a responsible-drinking line. Default 3.5 drinks per person (light 2, long night 6); 1 drink = a 60ml large peg, half a 650ml beer, or a 150ml glass of wine. |
| Trivia | General questions are answered freely. Brand facts come only from `brand_info`. Every answer ends with what's in stock. |
| Reserve | Holds items for 2 hours, or until closing if sooner. Held stock stops counting as available and the hold lapses by itself. Payment and age check happen at the counter. Blocked when the store is closed or on a dry day. |
| `priceMode` | `full` shows per-item prices; `totals_only` shows totals only; `none` shows no rupee amounts at all. Change it via `PATCH /api/stores/:id {"priceMode":"none"}` or the test page. |

Slang: quarter/pauwa = 180ml, half/adha = 375ml, full/botal/khamba = 750ml, beer = 650ml; small peg 30ml, large 60ml. Brand aliases (OM, BP, KF strong, MM, JD…) live in the `aliases` column of `data/brand_info.csv`, so a store can add its own without code changes.

## Inventory import

```bash
npm run import -- saket data/inventory.csv
npm run import -- saket "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
```

For a Google Sheet: File → Share → Publish to web → CSV. The header must be `brand,category,size_ml,price_inr,qty,tier`.

The import is a **full sync**. Any SKU missing from the file is set to qty 0. Invalid rows are skipped and listed.

POS systems (Tally, Marg, GoFrugal) will plug in by implementing `InventoryConnector` in `src/connectors/types.ts`: one `fetch()` that returns the same rows.

## Layout

```
data/              inventory.csv, brand_info.csv (seed data)
prisma/            schema.prisma, seed.ts
src/bot.ts         handleMessage(storeId, phone, text) — the one entry point for every channel
src/understand.ts  Claude structured-output call + rule-based fallback
src/slang.ts       slang/size/qty/peg parser
src/features/      stock, budget, trivia, reserve
src/connectors/    InventoryConnector + CSV/Sheet implementation
src/guardrails.ts  age gate, hours, dry days, delivery block
public/test.html   browser test chat
test/              node:test unit tests
```

## Where later phases plug in

- **Phase 2 (WhatsApp):** add a webhook route that maps the incoming business phone number to a `storeId` (add a column on `Store`) and calls `handleMessage()`. Nothing else changes.
- **Phase 3 (owner dashboard):** `DemandEvent` already logs every enquiry with its outcome (`in_stock` / `low` / `out_of_stock` / `not_stocked`). Missed demand is a query on that table. Reservations are in `Reservation`.
- **Phase 4 (onboarding/subscriptions):** a store is one `Store` row plus an inventory import.

## Before going live

- **Prices in the seed data are illustrative.** Load each store's real MRP list.
- **Dry days:** only the three fixed national ones are seeded. Add the Delhi Excise list (festivals, elections) to `DryDay` every year, per store.
- **Model and cost:** the default is `claude-opus-5-5` at low effort. Override it with `LLM_MODEL` in `.env`. Server-side refusal fallback is on (`fallbacks: "default"`), so if the model declines a message the API retries on a fallback model. If Claude fails entirely, the bot falls back to the rule parser.
- **SQLite** is fine for a pilot. Move to Postgres before many stores share one server; `reserve` has a `shortcut:` note about locking.
