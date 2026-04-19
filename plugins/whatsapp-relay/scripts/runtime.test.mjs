import test from "node:test";
import assert from "node:assert/strict";

import * as runtime from "./runtime.mjs";

test("renderTerminalQr produces a multi-line full-size QR suitable for terminal scanning", () => {
  const rendered = runtime.renderTerminalQr("https://example.com/whatsapp-auth");
  const lines = rendered.split("\n");

  assert.ok(lines.length > 20);
  assert.ok(lines.every((line) => line.length === lines[0].length));
  assert.ok(lines.some((line) => line.includes("██")));
});

test("renderCompactQr produces a narrower QR that is safer to paste into chat", () => {
  const compact = runtime.renderCompactQr?.("https://example.com/whatsapp-auth");
  const terminal = runtime.renderTerminalQr("https://example.com/whatsapp-auth");
  const compactLines = compact?.split("\n") ?? [];
  const terminalLines = terminal.split("\n");

  assert.equal(typeof compact, "string");
  assert.ok(compactLines.length > 10);
  assert.ok(compactLines.every((line) => line.length === compactLines[0].length));
  assert.ok(compactLines[0].length < terminalLines[0].length);
  assert.ok(compactLines.some((line) => /[▀▄█]/.test(line)));
});
