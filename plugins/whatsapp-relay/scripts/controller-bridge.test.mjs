import test from "node:test";
import assert from "node:assert/strict";

import {
  isSupportedInboundTextMessageType,
  normalizeVoiceCommandText,
  parseVoiceTranscript
} from "./controller-bridge.mjs";

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
