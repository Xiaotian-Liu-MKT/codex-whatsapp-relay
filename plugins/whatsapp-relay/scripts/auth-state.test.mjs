import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hasUsableStoredCreds,
  parseStoredCreds,
  repairCorruptAuthState,
  shouldRepairAuthState
} from "./auth-state.mjs";

test("parseStoredCreds rejects empty and malformed payloads", () => {
  assert.equal(parseStoredCreds(""), null);
  assert.equal(parseStoredCreds("not-json"), null);
  assert.equal(parseStoredCreds("{\"foo\":1}"), null);
});

test("parseStoredCreds accepts auth payloads with a noise key", () => {
  const parsed = parseStoredCreds(
    JSON.stringify({
      noiseKey: {
        private: "a",
        public: "b"
      }
    })
  );

  assert.deepEqual(parsed, {
    noiseKey: {
      private: "a",
      public: "b"
    }
  });
});

test("shouldRepairAuthState only triggers when invalid creds coexist with stale auth files", () => {
  assert.equal(
    shouldRepairAuthState({
      credsText: "",
      authEntries: [{ name: "creds.json" }, { name: "session-old.json" }]
    }),
    true
  );

  assert.equal(
    shouldRepairAuthState({
      credsText: "",
      authEntries: [{ name: "creds.json" }]
    }),
    false
  );

  assert.equal(
    shouldRepairAuthState({
      credsText: JSON.stringify({
        noiseKey: {
          private: "a",
          public: "b"
        }
      }),
      authEntries: [{ name: "creds.json" }, { name: "session-old.json" }]
    }),
    false
  );
});

test("hasUsableStoredCreds requires parseable non-empty creds", async () => {
  const authDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wa-auth-creds-"));
  const credsPath = path.join(authDir, "creds.json");

  assert.equal(hasUsableStoredCreds(authDir), false);

  await fsp.writeFile(credsPath, "", "utf8");
  assert.equal(hasUsableStoredCreds(authDir), false);

  await fsp.writeFile(credsPath, "{\"foo\":1}", "utf8");
  assert.equal(hasUsableStoredCreds(authDir), false);

  await fsp.writeFile(
    credsPath,
    JSON.stringify({
      noiseKey: {
        private: "a",
        public: "b"
      },
      registered: false
    }),
    "utf8"
  );
  assert.equal(hasUsableStoredCreds(authDir), false);

  await fsp.writeFile(
    credsPath,
    JSON.stringify({
      noiseKey: {
        private: "a",
        public: "b"
      }
      ,
      registered: true
    }),
    "utf8"
  );
  assert.equal(hasUsableStoredCreds(authDir), true);

  await fsp.rm(authDir, { recursive: true, force: true });
});

test("repairCorruptAuthState archives mixed stale auth state and recreates a clean folder", async () => {
  const authDir = await fsp.mkdtemp(path.join(os.tmpdir(), "wa-auth-repair-"));
  await fsp.writeFile(path.join(authDir, "creds.json"), "", "utf8");
  await fsp.writeFile(path.join(authDir, "session-legacy.json"), "{\"old\":true}", "utf8");

  const backupDir = await repairCorruptAuthState(authDir, {
    now: () => new Date("2026-04-19T05:20:30.000Z")
  });

  assert.ok(backupDir);
  assert.equal(fs.existsSync(authDir), true);
  assert.deepEqual(await fsp.readdir(authDir), []);
  assert.equal(fs.existsSync(path.join(backupDir, "session-legacy.json")), true);
  assert.equal(fs.existsSync(path.join(backupDir, "creds.json")), true);

  await fsp.rm(authDir, { recursive: true, force: true });
  await fsp.rm(backupDir, { recursive: true, force: true });
});
