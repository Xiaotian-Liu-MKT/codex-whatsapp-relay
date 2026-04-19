import { pathToFileURL } from "node:url";
import { ControllerConfigStore } from "./controller-config.mjs";
import { getGlobalControllerOwner } from "./controller-owner.mjs";
import { getControllerProcessStatus } from "./controller-process.mjs";
import { WhatsAppRuntime } from "./runtime.mjs";

export function shouldUseControllerStatus({
  controllerEnabled,
  controllerProcessStatus,
  globalOwner
}) {
  if (!controllerEnabled) {
    return false;
  }

  return Boolean(controllerProcessStatus?.running || globalOwner);
}

export async function main() {
  const runtime = new WhatsAppRuntime({
    logLevel: process.env.WHATSAPP_LOG_LEVEL ?? "error"
  });
  const controllerConfigStore = new ControllerConfigStore();

  if (!runtime.hasSavedCreds()) {
    process.stdout.write("status: not_authenticated\n");
    process.stdout.write(
      "next: use `whatsapp_start_auth` in Codex or run `npm run whatsapp:auth`\n"
    );
    process.exit(0);
  }

  const [controllerConfig, controllerProcessStatus, globalOwner] = await Promise.all([
    controllerConfigStore.load(),
    getControllerProcessStatus(),
    getGlobalControllerOwner()
  ]);

  if (
    shouldUseControllerStatus({
      controllerEnabled: controllerConfig.enabled,
      controllerProcessStatus,
      globalOwner
    })
  ) {
    process.stdout.write(
      `status: ${
        controllerProcessStatus.process.whatsappStatus
        ?? (controllerProcessStatus.running ? "connected_via_bridge" : "starting")
      }\n`
    );
    process.stdout.write("live_session_owner: controller_bridge\n");
    process.stdout.write(
      `pid: ${controllerProcessStatus.pid ?? globalOwner?.pid ?? "unknown"}\n`
    );
    if (controllerProcessStatus.process.whatsappUserId) {
      process.stdout.write(`user: ${controllerProcessStatus.process.whatsappUserId}\n`);
    }
    if (controllerProcessStatus.process.whatsappLastDisconnect?.label) {
      process.stdout.write(
        `last_disconnect: ${controllerProcessStatus.process.whatsappLastDisconnect.label}\n`
      );
    }
    process.exit(0);
  }

  await runtime.start({ printQrToTerminal: false });

  try {
    const socket = await runtime.waitForConnection(20_000);
    process.stdout.write("status: connected\n");
    process.stdout.write(`user: ${socket.user?.id ?? "unknown"}\n`);
    process.exit(0);
  } catch {
    const summary = runtime.summary();
    process.stdout.write(`status: ${summary.status}\n`);
    if (summary.lastDisconnect?.label) {
      process.stdout.write(`last_disconnect: ${summary.lastDisconnect.label}\n`);
    }
    process.stdout.write(
      "next: use `whatsapp_start_auth` in Codex or rerun `npm run whatsapp:auth` if the session was logged out\n"
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
