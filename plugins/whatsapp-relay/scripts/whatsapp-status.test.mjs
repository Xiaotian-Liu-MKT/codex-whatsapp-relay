import test from "node:test";
import assert from "node:assert/strict";

import { shouldUseControllerStatus } from "./whatsapp-status.mjs";

test("shouldUseControllerStatus stays on controller mode while the daemon owner is present", () => {
  assert.equal(
    shouldUseControllerStatus({
      controllerEnabled: true,
      controllerProcessStatus: { running: false },
      globalOwner: { pid: 6324 }
    }),
    true
  );
});

test("shouldUseControllerStatus falls back to direct runtime only when the controller is disabled", () => {
  assert.equal(
    shouldUseControllerStatus({
      controllerEnabled: false,
      controllerProcessStatus: { running: true },
      globalOwner: { pid: 6324 }
    }),
    false
  );
});
