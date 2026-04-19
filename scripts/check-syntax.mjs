import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function syntaxCheckDirectories(rootDir) {
  return [
    path.join(rootDir, "plugins", "whatsapp-relay", "scripts"),
    path.join(rootDir, "scripts")
  ];
}

async function defaultReaddir(directoryPath) {
  return fs.readdir(directoryPath, { withFileTypes: true });
}

export async function listSyntaxCheckTargets(rootDir = repoRoot, { readdir = defaultReaddir } = {}) {
  const targets = [];

  for (const directoryPath of syntaxCheckDirectories(rootDir)) {
    const entries = await readdir(directoryPath);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".mjs")) {
        continue;
      }
      targets.push(path.join(directoryPath, entry.name));
    }
  }

  return targets.sort((left, right) => left.localeCompare(right));
}

export async function runSyntaxCheck({
  repoRoot: rootDir = repoRoot,
  nodePath = process.execPath,
  readdir = defaultReaddir,
  spawnSync = nodeSpawnSync
} = {}) {
  const targets = await listSyntaxCheckTargets(rootDir, { readdir });
  if (!targets.length) {
    return 0;
  }

  const result = spawnSync(nodePath, ["--check", ...targets], {
    cwd: rootDir,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.status === "number" ? result.status : 1;
}

async function main() {
  process.exitCode = await runSyntaxCheck();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
