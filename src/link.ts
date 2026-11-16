// Usage: npm run link-whatsapp -- <storeId> <WhatsApp Phone Number ID from Meta>
import { db } from "./db.js";

const [storeId, phoneNumberId] = process.argv.slice(2);
if (!storeId || !/^\d{6,20}$/.test(phoneNumberId ?? "")) {
  console.error("Usage: npm run link-whatsapp -- <storeId> <Phone Number ID (digits, from Meta)>");
  console.error("Stores:", (await db.store.findMany({ select: { id: true } })).map((s) => s.id).join(", "));
  process.exit(1);
}
const taken = await db.store.findFirst({ where: { waPhoneNumberId: phoneNumberId, id: { not: storeId } } });
if (taken) {
  console.error(`That number is already linked to ${taken.name} (${taken.id}). One WhatsApp number = one store.`);
  process.exit(1);
}
const store = await db.store.update({ where: { id: storeId }, data: { waPhoneNumberId: phoneNumberId } });
console.log(`Linked ${store.name} to WhatsApp number ID ${phoneNumberId}.`);
await db.$disconnect();
