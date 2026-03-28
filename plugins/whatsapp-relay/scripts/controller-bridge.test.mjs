import test from "node:test";
import assert from "node:assert/strict";

import {
  extractLocalImageReferences,
  isSupportedInboundTextMessageType,
  normalizeVoiceCommandText,
  parseVoiceTranscript
} from "./controller-bridge.mjs";

test("extractLocalImageReferences finds markdown image links and bare paths once", () => {
  const refs = extractLocalImageReferences(`
Attached screenshot: [checkout-shot](/tmp/checkout.png)
Again here: /tmp/checkout.png
Inline image: ![hero image](/Users/abuiles/screenshots/hero.jpeg)
  `);

  assert.deepEqual(refs, [
    {
      filePath: "/tmp/checkout.png",
      caption: "checkout-shot"
    },
    {
      filePath: "/Users/abuiles/screenshots/hero.jpeg",
      caption: "hero image"
    }
  ]);
});

test("extractLocalImageReferences ignores non-image links", () => {
  const refs = extractLocalImageReferences(`
[notes](/tmp/readme.txt)
/tmp/output.json
  `);

  assert.deepEqual(refs, []);
});

test("isSupportedInboundTextMessageType only accepts textual WhatsApp message types", () => {
  assert.equal(isSupportedInboundTextMessageType("conversation"), true);
  assert.equal(isSupportedInboundTextMessageType("extendedTextMessage"), true);
  assert.equal(isSupportedInboundTextMessageType("audioMessage"), false);
  assert.equal(isSupportedInboundTextMessageType("imageMessage"), false);
});

test("normalizeVoiceCommandText removes accents and punctuation", () => {
  assert.equal(
    normalizeVoiceCommandText("  Nueva sesión, por favor! "),
    "nueva sesion por favor"
  );
});

test("parseVoiceTranscript maps exact spoken control commands conservatively", () => {
  assert.deepEqual(parseVoiceTranscript("Ayuda"), { type: "help" });
  assert.deepEqual(parseVoiceTranscript("estado"), { type: "status" });
  assert.deepEqual(parseVoiceTranscript("detente"), { type: "stop" });
  assert.deepEqual(parseVoiceTranscript("nueva sesión"), { type: "new", prompt: "" });
  assert.deepEqual(parseVoiceTranscript("please fix the checkout button"), {
    type: "prompt",
    prompt: "please fix the checkout button"
  });
});

test("parseVoiceTranscript respects captureAllDirectMessages when no voice command matches", () => {
  assert.deepEqual(parseVoiceTranscript("please fix the checkout button", false), {
    type: "ignored"
  });
});
