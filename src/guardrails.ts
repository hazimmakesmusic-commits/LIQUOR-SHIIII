import { db } from "./db.js";

export const LEGAL_AGE = 25; // Delhi drinking age

export const AGE_PROMPT =
  `Namaste! 🙏 Aage badhne se pehle ek baat: kya aapki age ${LEGAL_AGE} saal ya usse zyada hai? ` +
  `(Delhi me legal age ${LEGAL_AGE} hai.) Reply karein: *HAAN* ya *NAHI*`;
export const AGE_YES = /^\s*(haan|han|ha|haa|hanji|haan ji|ji|ji haan|yes|y|yeah|yep|25\+|i am 25\+)\s*[.!]*\s*$/i;
export const AGE_NO = /^\s*(nahi|nahin|na|no|nope|n)\s*[.!]*\s*$/i;
export const DELIVERY = /\b(deliver|delivery|home drop|ghar (pe|par|tak) (bhej|de|pahuncha)|bhijwa|parcel|courier|swiggy|zomato|blinkit)\b/i;

/** IST calendar date (YYYY-MM-DD) and fractional hour for a moment in time. */
export function ist(now: Date) {
  const t = new Date(now.getTime() + 5.5 * 3600_000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() + t.getUTCMinutes() / 60 };
}

/** The UTC instant for `hour`:00 IST on the given IST date. */
export function istAt(date: string, hour: number) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:00:00+05:30`);
}

const fmtHour = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

export type StoreStatus = { open: boolean; dryDay: string | null; note: string | null; closesAt: Date };

/** Is the store selling right now? Dry day beats hours. `note` is a line to prepend to replies. */
export async function storeStatus(store: { id: string; openHour: number; closeHour: number }, now: Date): Promise<StoreStatus> {
  const { date, hour } = ist(now);
  const dry = await db.dryDay.findUnique({ where: { storeId_date: { storeId: store.id, date } } });
  const closesAt = istAt(date, store.closeHour);
  const timing = `${fmtHour(store.openHour)}–${fmtHour(store.closeHour)}`;
  if (dry) return { open: false, dryDay: dry.reason, closesAt, note: `🚫 Aaj dry day hai (${dry.reason}), dukaan band hai. Jaankari de deta hoon, pickup agle din se.` };
  const open = hour >= store.openHour && hour < store.closeHour;
  return { open, dryDay: null, closesAt, note: open ? null : `🕙 Abhi dukaan band hai (timing ${timing}). Jaankari de deta hoon, pickup khulne ke baad.` };
}
