import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extractMessages, verifySignature } from "../src/whatsapp.js";

const body = Buffer.from(JSON.stringify({ hello: "world" }));
const sign = (b: Buffer, secret: string) => "sha256=" + createHmac("sha256", secret).update(b).digest("hex");

test("accepts only bodies signed with our app secret", () => {
  assert.equal(verifySignature(body, sign(body, "s3cret"), "s3cret"), true);
  assert.equal(verifySignature(body, sign(body, "other"), "s3cret"), false);
  assert.equal(verifySignature(Buffer.from("tampered"), sign(body, "s3cret"), "s3cret"), false);
  assert.equal(verifySignature(body, undefined, "s3cret"), false);
  assert.equal(verifySignature(body, "sha256=abc", "s3cret"), false);
});

test("extracts text, voice and other messages; ignores status updates", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      changes: [
        { field: "messages", value: {
          metadata: { phone_number_id: "1111" },
          messages: [
            { from: "919800000001", id: "m1", type: "text", text: { body: "OM half hai?" } },
            { from: "919800000002", id: "m2", type: "audio", audio: { id: "media9", mime_type: "audio/ogg; codecs=opus", voice: true } },
            { from: "919800000003", id: "m3", type: "image", image: { id: "x" } },
          ],
        } },
        { field: "messages", value: { metadata: { phone_number_id: "1111" }, statuses: [{ id: "m0", status: "read" }] } },
      ],
    }],
  };
  assert.deepEqual(extractMessages(payload), [
    { phoneNumberId: "1111", from: "919800000001", id: "m1", type: "text", text: "OM half hai?" },
    { phoneNumberId: "1111", from: "919800000002", id: "m2", type: "audio", mediaId: "media9" },
    { phoneNumberId: "1111", from: "919800000003", id: "m3", type: "other" },
  ]);
  assert.deepEqual(extractMessages({}), []);
  assert.deepEqual(extractMessages(null), []);
});
