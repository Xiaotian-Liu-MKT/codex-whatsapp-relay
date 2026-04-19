import { existsSync } from "node:fs";

import { ControllerConfigStore } from "./controller-config.mjs";
import { startControllerDaemon } from "./controller-process.mjs";
import { credsFile } from "./paths.mjs";

async function main() {
  const configStore = new ControllerConfigStore();
  const config = await configStore.load();

  if (!config.enabled) {
    process.stdout.write("Autostart skipped: controller bridge is disabled.\n");
    return;
  }

  if (!config.allowedControllers.length) {
    process.stdout.write("Autostart skipped: no allowed controllers configured.\n");
    return;
  }

  if (!existsSync(credsFile)) {
    process.stdout.write("Autostart skipped: WhatsApp auth credentials are missing.\n");
    return;
  }

  const status = await startControllerDaemon();
  process.stdout.write(
    `Autostart ensured controller bridge is running (pid ${status.pid ?? "unknown"}).\n`
  );
}

main().catch((error) => {
  process.stderr.write(`Autostart failed: ${error.message}\n`);
  process.exitCode = 1;
});
