import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

function authBackupStamp(now = new Date()) {
  return now.toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "Z");
}

export function parseStoredCreds(raw) {
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (!parsed.noiseKey || typeof parsed.noiseKey !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function hasUsableStoredCreds(authDir) {
  const credsPath = path.join(authDir, "creds.json");
  if (!existsSync(credsPath)) {
    return false;
  }

  try {
    return parseStoredCreds(readFileSync(credsPath, "utf8"))?.registered === true;
  } catch {
    return false;
  }
}

export function shouldRepairAuthState({ credsText, authEntries }) {
  const hasStaleAuthEntries = authEntries.some((entry) => entry.name !== "creds.json");
  return parseStoredCreds(credsText) === null && hasStaleAuthEntries;
}

export async function repairCorruptAuthState(authDir, { now = () => new Date() } = {}) {
  await fs.mkdir(authDir, { recursive: true });

  const authEntries = await fs.readdir(authDir, {
    withFileTypes: true
  });

  let credsText = null;
  try {
    credsText = await fs.readFile(path.join(authDir, "creds.json"), "utf8");
  } catch {
    credsText = null;
  }

  if (!shouldRepairAuthState({ credsText, authEntries })) {
    return null;
  }

  const backupDir = `${authDir}.corrupt-${authBackupStamp(now())}`;
  await fs.rename(authDir, backupDir);
  await fs.mkdir(authDir, { recursive: true });
  return backupDir;
}
