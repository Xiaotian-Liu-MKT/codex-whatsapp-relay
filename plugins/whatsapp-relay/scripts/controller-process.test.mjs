import test from "node:test";
import assert from "node:assert/strict";

import { controllerDaemonEnv } from "./controller-process.mjs";

test("controllerDaemonEnv persists relay TTS defaults into the daemon environment", () => {
  const env = controllerDaemonEnv(
    {
      ttsProvider: "chatterbox-turbo",
      ttsChatterboxAllowNonEnglish: true
    },
    {
      PATH: "/tmp/bin",
      WHATSAPP_RELAY_TTS_PROVIDER: "system",
      WHATSAPP_RELAY_TTS_CHATTERBOX_ALLOW_NON_ENGLISH: "0"
    }
  );

  assert.equal(env.PATH, "/tmp/bin");
  assert.equal(env.WHATSAPP_RELAY_TTS_PROVIDER, "chatterbox-turbo");
  assert.equal(env.WHATSAPP_RELAY_TTS_CHATTERBOX_ALLOW_NON_ENGLISH, "1");
});

test("controllerDaemonEnv disables non-English Chatterbox fallback when config says no", () => {
  const env = controllerDaemonEnv(
    {
      ttsProvider: "system",
      ttsChatterboxAllowNonEnglish: false
    },
    {
      WHATSAPP_RELAY_TTS_CHATTERBOX_ALLOW_NON_ENGLISH: "1"
    }
  );

  assert.equal(env.WHATSAPP_RELAY_TTS_PROVIDER, "system");
  assert.equal(env.WHATSAPP_RELAY_TTS_CHATTERBOX_ALLOW_NON_ENGLISH, "0");
});
